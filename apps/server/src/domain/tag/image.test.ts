import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createCategoryService } from "../cat/service.ts"
import { tags } from "./schema.ts"
import { createTagService, type TagService } from "./service.ts"

/**
 * Image slot + link behaviour of the tag service: archive-versioned
 * writes, rebuildable imageMeta, the trash / `.deleted` lifecycle and the
 * merge semantics (the target keeps its own image/link, the source's
 * bytes are cleaned up with the row).
 */
describe("tag image + link service", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let svc: TagService
	let catId: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-tag-image-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		svc = createTagService({ db: dbh.db, paths, readOnly: { current: false } })
		const cats = createCategoryService({ db: dbh.db })
		catId = (await cats.create({ name: "Common", kind: "common" })).id
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("create stores the trimmed link and defaults to an empty string", async () => {
		const withLink = await svc.create({
			name: "Linked",
			catId,
			link: "  https://example.com/art  ",
		})
		expect(withLink.link).toBe("https://example.com/art")
		expect(withLink.imageMeta).toBeUndefined()

		const plain = await svc.create({ name: "Plain", catId })
		expect(plain.link).toBe("")
	})

	test("update sets and clears the link", async () => {
		const t = await svc.create({ name: "Linkable", catId })
		const linked = await svc.update({ id: t.id, link: "www.example.com/a" })
		expect(linked.link).toBe("www.example.com/a")
		const cleared = await svc.update({ id: t.id, link: "" })
		expect(cleared.link).toBe("")
	})

	test("setImage writes to the current version, bumps imageVersion and fills imageMeta", async () => {
		const t = await svc.create({ name: "WithArt", catId })
		expect(await svc.getImageVersion(t.id)).toBe(1)
		const source = join(root, "tmp-art.png")
		writeFileSync(source, "fake-image")

		const updated = await svc.setImage(t.id, ".png", source)
		expect(await svc.getImageVersion(t.id)).toBe(paths.latestVersion)
		expect(updated.imageMeta).toMatchObject({ kind: "image" })

		const imagePath = await svc.resolveImagePath(t.id)
		expect(imagePath).toBeTruthy()
		expect(imagePath?.startsWith(paths.latest.tag(t.id))).toBe(true)
		expect(existsSync(imagePath ?? "")).toBe(true)
	})

	test("setImage archives the previous art to local/cache/tags/<id>", async () => {
		const t = await svc.create({ name: "ArchiveMe", catId })
		const first = join(root, "first.png")
		const second = join(root, "second.png")
		writeFileSync(first, "first-image")
		writeFileSync(second, "second-image")

		await svc.setImage(t.id, ".png", first)
		const firstContent = readFileSync((await svc.resolveImagePath(t.id)) ?? "")

		await svc.setImage(t.id, ".png", second)
		const secondContent = readFileSync((await svc.resolveImagePath(t.id)) ?? "")

		expect(secondContent).not.toEqual(firstContent)
		expect(existsSync(paths.local.tag(t.id))).toBe(true)
		const archived = readdirSync(paths.local.tag(t.id)).some((name) =>
			name.startsWith("image_"),
		)
		expect(archived).toBe(true)
	})

	test("clearImage removes the file and resets the slot meta", async () => {
		const t = await svc.create({ name: "ClearMe", catId })
		const source = join(root, "art.png")
		writeFileSync(source, "fake-image")

		const afterSet = await svc.setImage(t.id, ".png", source)
		expect(afterSet.imageMeta).toMatchObject({ kind: "image" })

		const cleared = await svc.clearImage(t.id)
		expect(await svc.getImageVersion(t.id)).toBe(paths.latestVersion)
		expect(await svc.resolveImagePath(t.id)).toBeUndefined()
		expect(cleared.imageMeta).toEqual({ empty: true })
	})

	test("listAll fills a missing imageMeta from disk without bumping updatedAt", async () => {
		const t = await svc.create({ name: "Backfill", catId })
		const before = t.updatedAt
		dbh.db.update(tags).set({ imageMeta: null }).where(eq(tags.id, t.id)).run()

		const listed = await svc.listAll()
		const row = listed.find((item) => item.id === t.id)
		expect(row?.imageMeta).toEqual({ empty: true })
		expect(row?.updatedAt).toBe(before)
	})

	test("setImage refuses to write when readOnly is true", async () => {
		const readOnlySvc = createTagService({
			db: dbh.db,
			paths,
			readOnly: { current: true },
		})
		const t = await svc.create({ name: "Frozen", catId })
		const source = join(root, "art.png")
		writeFileSync(source, "fake-image")

		await expect(
			readOnlySvc.setImage(t.id, ".png", source),
		).rejects.toMatchObject({ kind: "server.read_only_archive" })
	})

	test("delete trashes the folder when bytes live in the current version", async () => {
		const t = await svc.create({ name: "DeleteMe", catId })
		const source = join(root, "art.png")
		writeFileSync(source, "fake-image")
		await svc.setImage(t.id, ".png", source)
		expect(existsSync(paths.latest.tag(t.id))).toBe(true)

		await svc.delete(t.id)
		expect(existsSync(paths.latest.tag(t.id))).toBe(false)
		const trashed = readdirSync(paths.local.trash()).filter((name) =>
			name.startsWith("tags-"),
		)
		expect(trashed.length).toBe(1)
	})

	test("forceDelete requires the exact name and cleans the folder", async () => {
		const t = await svc.create({ name: "ConfirmMe", catId })
		const source = join(root, "art.png")
		writeFileSync(source, "fake-image")
		await svc.setImage(t.id, ".png", source)

		await expect(svc.forceDelete(t.id, "wrong name")).rejects.toMatchObject({
			kind: "tag.confirm_name_mismatch",
		})
		await expect(svc.detail(t.id)).resolves.toMatchObject({ name: "ConfirmMe" })

		await svc.forceDelete(t.id, "ConfirmMe")
		await expect(svc.detail(t.id)).rejects.toThrow()
		const trashed = readdirSync(paths.local.trash()).filter((name) =>
			name.startsWith("tags-"),
		)
		expect(trashed.length).toBe(1)
	})

	test("delete marks .deleted instead of trashing when bytes live only under a frozen archive", async () => {
		const t = await svc.create({ name: "FrozenArt", catId })
		const source = join(root, "art.png")
		writeFileSync(source, "fake-image")
		await svc.setImage(t.id, ".png", source)

		// Simulate an archive rotation: the bytes now only exist under a
		// past (frozen) archive, so the current-version folder cannot be
		// moved — a `.deleted` placeholder is the only legal write.
		dbh.db.update(tags).set({ imageVersion: 0 }).where(eq(tags.id, t.id)).run()

		await svc.delete(t.id)
		expect(existsSync(join(paths.latest.tag(t.id), ".deleted"))).toBe(true)
		const trashed = existsSync(paths.local.trash())
			? readdirSync(paths.local.trash()).filter((name) =>
					name.startsWith("tags-"),
				)
			: []
		expect(trashed.length).toBe(0)
	})

	test("merge keeps the target's own image and link and cleans the source folder", async () => {
		const target = await svc.create({
			name: "KeepMe",
			catId,
			link: "https://keep",
		})
		const source = await svc.create({
			name: "DropMe",
			catId,
			link: "https://drop",
		})
		const art = join(root, "art.png")
		writeFileSync(art, "fake-image")
		await svc.setImage(source.id, ".png", art)

		await svc.merge(source.id, target.id)
		await expect(svc.detail(source.id)).rejects.toThrow()

		const merged = await svc.detail(target.id)
		expect(merged.link).toBe("https://keep")
		expect(merged.imageMeta).toBeUndefined()

		expect(existsSync(paths.latest.tag(source.id))).toBe(false)
		const trashed = readdirSync(paths.local.trash()).filter((name) =>
			name.startsWith("tags-"),
		)
		expect(trashed.length).toBe(1)
	})
})
