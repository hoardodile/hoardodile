import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { describe, expect, test } from "vitest"
import {
	buildTrashedArtifactView,
	findTrashedResourcePath,
} from "./trash-fallback.ts"

async function seedTrashEntry(
	root: string,
	entry: string,
	files: readonly string[],
): Promise<void> {
	const entryDir = join(root, "local", "trash", entry)
	await mkdir(join(entryDir, "data"), { recursive: true })
	for (const name of files) {
		await writeFile(join(entryDir, "data", name), "x")
	}
}

describe("buildTrashedArtifactView", () => {
	test("roots the view at the data/ content folder, like live resources", async () => {
		const root = mkdtempSync(join(tmpdir(), "trash-view-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			await seedTrashEntry(root, "resources-res-1-1700000000000", [
				"a.jpg",
				"b.mp4",
			])

			const view = await buildTrashedArtifactView(paths, "res-1")

			expect(view).toBeDefined()
			expect(await view!.listEntries()).toEqual(["a.jpg", "b.mp4"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("returns undefined when the trash entry has no data/ folder", async () => {
		const root = mkdtempSync(join(tmpdir(), "trash-view-missing-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			await mkdir(
				join(root, "local", "trash", "resources-res-2-1700000000001"),
				{
					recursive: true,
				},
			)

			await expect(buildTrashedArtifactView(paths, "res-2")).resolves.toBe(
				undefined,
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("returns undefined when no trash entry matches", async () => {
		const root = mkdtempSync(join(tmpdir(), "trash-view-none-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			await expect(
				buildTrashedArtifactView(paths, "res-missing"),
			).resolves.toBe(undefined)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("findTrashedResourcePath", () => {
	test("resolves the matching trash entry folder", async () => {
		const root = mkdtempSync(join(tmpdir(), "trash-find-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			await mkdir(
				join(root, "local", "trash", "resources-res-3-1700000000002"),
				{ recursive: true },
			)

			const found = await findTrashedResourcePath(paths, "res-3")
			expect(found).toBe(
				join(root, "local", "trash", "resources-res-3-1700000000002"),
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("returns undefined when no entry matches the id", async () => {
		const root = mkdtempSync(join(tmpdir(), "trash-find-none-"))
		try {
			const paths = createStoragePaths({ root, latestVersion: 1 })
			await mkdir(
				join(root, "local", "trash", "resources-other-4-1700000000003"),
				{ recursive: true },
			)

			await expect(findTrashedResourcePath(paths, "res-4")).resolves.toBe(
				undefined,
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
