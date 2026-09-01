import * as fs from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { seedResourceArtifact } from "src/domain/res/test-seed.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import yauzl from "yauzl"
import yazl from "yazl"
import { parseByteRange } from "./byte-range.ts"

// Wrap createReadStream so tests can assert how the server opens files
// (e.g. that literal ranges use kernel-seeked windows, never draining
// the whole file through sliceStream). All other fs functions pass
// through untouched.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>()
	return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

const REMOTE_ADDR = "127.0.0.1"
const PAYLOAD = Buffer.from("The quick brown fox jumps over the lazy dog.")
const BULK_PACK_DATE_STAMP = "2024-06-12"

async function bootstrap(
	storageRoot: string,
	envOverrides?: Partial<NodeJS.ProcessEnv>,
): Promise<BuiltServer> {
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		...envOverrides,
	} as NodeJS.ProcessEnv)
	const db = openDb(":memory:")
	db.runMigrations()
	const passwordHash = await hashPassword("hunter2")
	db.db
		.insert(schema.auth)
		.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
		.run()
	return buildServer({
		env,
		dbHandles: db,
		storagePaths: createStoragePaths({ root: storageRoot }),
	})
}

async function login(server: BuiltServer): Promise<string> {
	const res = await server.app.inject({
		method: "POST",
		url: "/auth/login",
		remoteAddress: REMOTE_ADDR,
		payload: { password: "hunter2" },
	})
	const raw = res.headers["set-cookie"]
	const line = Array.isArray(raw) ? raw[0] : raw
	if (typeof line !== "string") throw new Error("no cookie")
	const head = line.split(";")[0]
	if (head === undefined) throw new Error("malformed cookie")
	return head
}

async function zipEntryNames(zipBuffer: Buffer): Promise<string[]> {
	const names: string[] = []
	await new Promise<void>((resolve, reject) => {
		yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
			if (err !== null || zipfile === undefined) {
				reject(err ?? new Error("missing zipfile"))
				return
			}
			zipfile.readEntry()
			zipfile.on("entry", (entry: { fileName: string }) => {
				names.push(entry.fileName.replace(/\\/g, "/"))
				zipfile.readEntry()
			})
			zipfile.on("end", () => resolve())
			zipfile.on("error", reject)
		})
	})
	return names.sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
	)
}

async function createResourceId(server: BuiltServer): Promise<string> {
	const resource = await server.app.resService.create({ name: "r" })
	return resource.id
}

/** A real 40×30 PNG so the sharp pipeline can render variants from it. */
async function makePng(): Promise<Buffer> {
	return sharp({
		create: {
			width: 40,
			height: 30,
			channels: 3,
			background: { r: 1, g: 2, b: 3 },
		},
	})
		.png()
		.toBuffer()
}

describe("resource files HTTP", () => {
	let root: string
	let built: BuiltServer
	let cookie: string
	let id: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-files-"))
		built = await bootstrap(root)
		await built.app.ready()
		cookie = await login(built)
		id = await createResourceId(built)
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("GET returns 200 with full body for a seeded file", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "a.png", bytes: PAYLOAD }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/a.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["accept-ranges"]).toBe("bytes")
		expect(res.headers["content-type"]).toBe("image/png")
		expect(res.headers["content-length"]).toBe(String(PAYLOAD.length))
		expect(Buffer.from(res.rawPayload)).toEqual(PAYLOAD)
	})

	test("GET /extracted serves plugin-materialized files and guards traversal", async () => {
		const fileVersion = 1
		const archivesDir = built.storagePaths.local.resExtractedArchivesDir(
			id,
			fileVersion,
		)
		const { mkdir, writeFile } = await import("node:fs/promises")
		await mkdir(join(archivesDir, "book.cbz", "Ch1"), { recursive: true })
		await writeFile(
			join(archivesDir, "book.cbz", "Ch1", "001.jpg"),
			Buffer.from("page-bytes"),
		)
		await writeFile(
			join(archivesDir, "book.cbz", "index.json"),
			Buffer.from("{}"),
		)

		const ok = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/extracted/book.cbz/Ch1/001.jpg`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(ok.statusCode).toBe(200)
		expect(ok.headers["content-type"]).toBe("image/jpeg")
		expect(Buffer.from(ok.rawPayload).toString()).toBe("page-bytes")

		const missing = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/extracted/book.cbz/nope.jpg`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(missing.statusCode).toBe(404)

		const escapeReq = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/extracted/%2e%2e/%2e%2e/etc/passwd`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		// The traversal is rejected either at segment validation (400) or
		// by the containment check/stat (404) — never served.
		expect(escapeReq.statusCode).toBeGreaterThanOrEqual(400)
		expect(escapeReq.statusCode).toBeLessThan(500)
	})

	test("GET /files serves materialized non-zip container entries", async () => {
		// A real artifact dir makes the source view a `buildDirView`, which
		// wires the plugin extraction cache into `outer!inner` addressing.
		// Simulate a plugin calling `extractArchive("book.cb7")`: the cache
		// holds `<archivesDir>/book.cb7/<inner>` plus a manifest.
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "seed.txt", bytes: Buffer.from("x") }],
		)
		const fileVersion = 1
		const archivesDir = built.storagePaths.local.resExtractedArchivesDir(
			id,
			fileVersion,
		)
		const { mkdir, writeFile } = await import("node:fs/promises")
		await mkdir(join(archivesDir, "book.cb7", "Ch1"), { recursive: true })
		await writeFile(
			join(archivesDir, "book.cb7", "Ch1", "001.jpg"),
			Buffer.from("page-bytes"),
		)
		await writeFile(
			join(archivesDir, "book.cb7", "index.json"),
			JSON.stringify({
				v: 1,
				archiveName: "book.cb7",
				entries: [{ path: "Ch1/001.jpg", sizeBytes: 10, kind: "image" }],
			}),
		)

		const ok = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/book.cb7!Ch1/001.jpg`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(ok.statusCode).toBe(200)
		expect(ok.headers["content-type"]).toBe("image/jpeg")
		expect(Buffer.from(ok.rawPayload).toString()).toBe("page-bytes")

		// An entry that is not in the manifest is not served.
		const missing = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/book.cb7!nope.jpg`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(missing.statusCode).toBe(404)
	})

	test("GET /files streams a zip container entry from its central directory", async () => {
		// A deflated cbz as a bare top-level file; the `/files` route must
		// stream the inner entry without any extraction.
		const zip = new yazl.ZipFile()
		zip.addBuffer(Buffer.from("zip-page-bytes"), "Ch1/001.jpg")
		zip.addBuffer(Buffer.from("zip-page-two"), "Ch1/002.jpg")
		zip.end()
		const chunks: Buffer[] = []
		for await (const chunk of zip.outputStream) {
			chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
		}
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "book.cbz", bytes: Buffer.concat(chunks) }],
		)

		const ok = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/book.cbz!Ch1/001.jpg`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(ok.statusCode).toBe(200)
		expect(ok.headers["content-type"]).toBe("image/jpeg")
		expect(Buffer.from(ok.rawPayload).toString()).toBe("zip-page-bytes")

		const missing = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/book.cbz!nope.jpg`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(missing.statusCode).toBe(404)
	})

	test("GET /extract-progress reports in-flight materialization", async () => {
		built.app.resService.extractProgress.record(id, {
			done: 2,
			total: 5,
			updatedAt: Date.now(),
		})
		const busy = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/extract-progress/tok/`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(busy.statusCode).toBe(200)
		expect(busy.json()).toEqual({ done: 2, total: 5 })

		// A resource without an in-flight extraction answers null.
		const idle = await built.app.inject({
			method: "GET",
			url: `/api/resources/idle-resource/extract-progress/tok/`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(idle.statusCode).toBe(200)
		expect(idle.json()).toBeNull()
	})

	test("GET with Range returns 206 and correct slice + Content-Range", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "a.png", bytes: PAYLOAD }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/a.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, range: "bytes=4-10" },
		})
		expect(res.statusCode).toBe(206)
		expect(res.headers["content-range"]).toBe(`bytes 4-10/${PAYLOAD.length}`)
		expect(res.headers["content-length"]).toBe("7")
		expect(Buffer.from(res.rawPayload)).toEqual(PAYLOAD.subarray(4, 11))
	})

	test("literal 206 ranges are served through a kernel-seeked window", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "a.png", bytes: PAYLOAD }],
		)
		const createReadStreamMock = vi.mocked(fs.createReadStream)
		createReadStreamMock.mockClear()
		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/a.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, range: "bytes=4-10" },
		})
		expect(res.statusCode).toBe(206)
		// The literal file must be served through a kernel-seeked window —
		// a regression back to sliceStream would open without start/end
		// and drain the whole prefix. (The container also opens one
		// full-file stream per request for size/mtime; the windowed call
		// is the one that carries the range.)
		const windowedCalls = createReadStreamMock.mock.calls.filter(
			(call) =>
				String(call[0]).endsWith("a.png") &&
				typeof (call[1] as { start?: unknown } | undefined)?.start === "number",
		)
		expect(windowedCalls.length).toBeGreaterThan(0)
		const opts = windowedCalls[0]?.[1] as
			| { readonly start?: number; readonly end?: number }
			| undefined
		expect(opts?.start).toBe(4)
		expect(opts?.end).toBe(10)
		expect(Buffer.from(res.rawPayload)).toEqual(PAYLOAD.subarray(4, 11))
	})

	test("GET file sets a stable ETag and answers 304 on revalidation", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "a.png", bytes: PAYLOAD }],
		)

		const first = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/a.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(first.statusCode).toBe(200)
		const etag = first.headers.etag
		expect(typeof etag).toBe("string")
		expect(etag).toMatch(/^"\d+-\d+"$/)

		const revalidated = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/a.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, "if-none-match": etag },
		})
		expect(revalidated.statusCode).toBe(304)
		expect(revalidated.rawPayload.length).toBe(0)

		// A mismatched tag still streams the body.
		const stale = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/a.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, "if-none-match": '"0-0"' },
		})
		expect(stale.statusCode).toBe(200)
		expect(Buffer.from(stale.rawPayload)).toEqual(PAYLOAD)
	})

	test("GET for unknown file returns 404", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/nope.png`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(404)
	})

	test("variant query renders an exact webp at source dimensions", async () => {
		const png = await makePng()
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "tex.png", bytes: png }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/tex.png?fmt=webp&fit=exact`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-type"]).toBe("image/webp")
		const meta = await sharp(Buffer.from(res.rawPayload)).metadata()
		expect(meta.width).toBe(40)
		expect(meta.height).toBe(30)
		expect(res.headers["cache-control"]).toContain("immutable")
	})

	test("size=preview stays the default-variant compatibility alias", async () => {
		const png = await makePng()
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "tex.png", bytes: png }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/files/tex.png?size=preview`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-type"]).toBe("image/avif")
	})

	test("invalid variant parameters are rejected with 400", async () => {
		const png = await makePng()
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "tex.png", bytes: png }],
		)

		for (const query of [
			"fmt=png",
			"fit=cover",
			"area=0",
			"area=1.5",
			"q=101",
		]) {
			const res = await built.app.inject({
				method: "GET",
				url: `/api/resources/${id}/files/tex.png?${query}`,
				remoteAddress: REMOTE_ADDR,
				headers: { cookie },
			})
			expect(res.statusCode).toBe(400)
		}
	})

	test("GET file sets Content-Disposition with UTF-8 filename*", async () => {
		const rid = (await built.app.resService.create({ name: "Model A" })).id
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			rid,
			[{ name: "blob.bin", bytes: PAYLOAD }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${rid}/files/blob.bin`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		const cd = res.headers["content-disposition"]
		expect(cd).toContain("attachment")
		expect(cd).toContain("filename*=")
		expect(cd).toContain(encodeURIComponent("Model A.bin"))
	})

	test("GET source.zip sets Content-Disposition and streams a zip", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "doc.txt", bytes: PAYLOAD }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/source.zip`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-type"]).toBe("application/zip")
		const cd = res.headers["content-disposition"]
		expect(cd).toContain("attachment")
		expect(cd).toContain("filename*=")
		expect(cd).toContain(encodeURIComponent("r.zip"))
		const buf = Buffer.from(res.rawPayload)
		expect(buf.subarray(0, 2).toString("ascii")).toBe("PK")
		const entries = await zipEntryNames(buf)
		// The download packs the resource's bare files into a zip.
		expect(entries).toContain("doc.txt")
	})

	test("GET source.zip packs a single-archive resource whole, not its inner members", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "book.cbz", bytes: Buffer.from("opaque archive bytes") }],
		)

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/source.zip`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		const entries = await zipEntryNames(Buffer.from(res.rawPayload))
		// The source is a single stored archive; the export keeps it whole
		// and never unwraps it into the members a content plugin might list.
		expect(entries).toEqual(["book.cbz"])
	})

	test("GET source.zip records a resource.export footprint", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "doc.txt", bytes: PAYLOAD }],
		)
		const before = (await built.app.traceService.timeline({})).rows.length

		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/source.zip`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)

		const timeline = await built.app.traceService.timeline({})
		expect(timeline.rows).toHaveLength(before + 1)
		expect(timeline.rows[0]).toMatchObject({
			action: "resource.export",
			entityType: "resource",
			entityId: id,
			entityName: "r",
		})
	})

	test("POST bulk-source.zip records one export footprint per resource", async () => {
		const idA = (await built.app.resService.create({ name: "Pack-Alpha" })).id
		const idB = (await built.app.resService.create({ name: "Pack-Beta" })).id
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			idA,
			[{ name: "one.txt", bytes: PAYLOAD }],
		)
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			idB,
			[{ name: "two.txt", bytes: PAYLOAD.subarray(0, 4) }],
		)
		const before = (await built.app.traceService.timeline({})).rows.length

		const res = await built.app.inject({
			method: "POST",
			url: "/api/resources/bulk-source.zip",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, "content-type": "application/json" },
			payload: JSON.stringify({
				ids: [idA, idB],
				dateStamp: BULK_PACK_DATE_STAMP,
			}),
		})
		expect(res.statusCode).toBe(200)

		const timeline = await built.app.traceService.timeline({})
		const exports = timeline.rows.filter(
			(row) => row.action === "resource.export",
		)
		expect(timeline.rows).toHaveLength(before + 2)
		expect(exports.map((row) => row.entityName).sort()).toEqual([
			"Pack-Alpha",
			"Pack-Beta",
		])
		expect(exports.every((row) => row.detail?.bulk === true)).toBe(true)
	})

	test("export records no footprint while the server is read-only", async () => {
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			id,
			[{ name: "doc.txt", bytes: PAYLOAD }],
		)
		const ro = await buildServer({
			env: loadEnv({
				NODE_ENV: "test",
				LOG_LEVEL: "silent",
			} as NodeJS.ProcessEnv),
			dbHandles: built.db,
			storagePaths: built.storagePaths,
			readOnly: true,
		})
		await ro.app.ready()
		const roCookie = await login(ro)
		const before = (await built.app.traceService.timeline({})).rows.length

		const res = await ro.app.inject({
			method: "GET",
			url: `/api/resources/${id}/source.zip`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie: roCookie },
		})
		expect(res.statusCode).toBe(200)

		const timeline = await built.app.traceService.timeline({})
		expect(timeline.rows).toHaveLength(before)
		await ro.close()
	})

	test("POST bulk-source.zip merges sources without nested zip entries", async () => {
		const idA = (await built.app.resService.create({ name: "Pack-Alpha" })).id
		const idB = (await built.app.resService.create({ name: "Pack-Beta" })).id
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			idA,
			[{ name: "one.txt", bytes: PAYLOAD }],
		)
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			idB,
			[{ name: "two.txt", bytes: PAYLOAD.subarray(0, 4) }],
		)

		const res = await built.app.inject({
			method: "POST",
			url: "/api/resources/bulk-source.zip",
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/json",
			},
			payload: JSON.stringify({
				ids: [idA, idB],
				dateStamp: BULK_PACK_DATE_STAMP,
			}),
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-type"]).toBe("application/zip")
		expect(res.headers["content-disposition"]).toContain(
			"hoardodile-resources-",
		)
		const buf = Buffer.from(res.rawPayload)
		const entries = await zipEntryNames(buf)
		// The bulk pack contains the resource files, not the source folders.
		expect(entries.some((e) => e.includes("Pack-Alpha/one.txt"))).toBe(true)
		expect(entries.some((e) => e.includes("Pack-Beta/two.txt"))).toBe(true)
	})

	test("POST bulk-source.zip sorts by created time by default", async () => {
		const idA = (await built.app.resService.create({ name: "Pack-Alpha" })).id
		const idB = (await built.app.resService.create({ name: "Pack-Beta" })).id
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			idA,
			[{ name: "one.txt", bytes: PAYLOAD }],
		)
		await seedResourceArtifact(
			{ db: built.db, paths: built.storagePaths },
			idB,
			[{ name: "two.txt", bytes: PAYLOAD.subarray(0, 4) }],
		)

		const resDefault = await built.app.inject({
			method: "POST",
			url: "/api/resources/bulk-source.zip",
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/json",
			},
			payload: JSON.stringify({
				ids: [idB, idA],
				dateStamp: BULK_PACK_DATE_STAMP,
			}),
		})
		expect(resDefault.statusCode).toBe(200)
		let entries = await zipEntryNames(Buffer.from(resDefault.rawPayload))
		expect(entries.some((e) => e.includes("Pack-Alpha/one.txt"))).toBe(true)
		expect(entries.some((e) => e.includes("Pack-Beta/two.txt"))).toBe(true)

		const resSelectionOrder = await built.app.inject({
			method: "POST",
			url: "/api/resources/bulk-source.zip",
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/json",
			},
			payload: JSON.stringify({
				ids: [idB, idA],
				sortByCreated: false,
				dateStamp: BULK_PACK_DATE_STAMP,
			}),
		})
		expect(resSelectionOrder.statusCode).toBe(200)
		entries = await zipEntryNames(Buffer.from(resSelectionOrder.rawPayload))
		expect(entries.some((e) => e.includes("1-Pack-Beta/two.txt"))).toBe(true)
		expect(entries.some((e) => e.includes("2-Pack-Alpha/one.txt"))).toBe(true)
	})
})

describe("parseByteRange", () => {
	test("parses bytes=start-end", () => {
		expect(parseByteRange("bytes=0-9", 100)).toEqual({
			ok: true,
			start: 0,
			end: 9,
		})
	})

	test("caps end at totalSize-1", () => {
		expect(parseByteRange("bytes=90-200", 100)).toEqual({
			ok: true,
			start: 90,
			end: 99,
		})
	})

	test("parses bytes=start- (open-ended)", () => {
		expect(parseByteRange("bytes=50-", 100)).toEqual({
			ok: true,
			start: 50,
			end: 99,
		})
	})

	test("parses bytes=-suffix (suffix length)", () => {
		expect(parseByteRange("bytes=-10", 100)).toEqual({
			ok: true,
			start: 90,
			end: 99,
		})
	})

	test("rejects multi-range", () => {
		expect(parseByteRange("bytes=0-5,10-15", 100).ok).toBe(false)
	})

	test("rejects out-of-bounds start", () => {
		expect(parseByteRange("bytes=500-600", 100).ok).toBe(false)
	})

	test("rejects start > end", () => {
		expect(parseByteRange("bytes=50-10", 100).ok).toBe(false)
	})
})
