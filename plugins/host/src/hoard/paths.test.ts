import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import {
	assertInside,
	assertSafeSegment,
	createStoragePaths,
	imageVariantKey,
} from "./paths.ts"

// path-guard-exempt: platform branch, each literal matches its own OS.
const ROOT = process.platform === "win32" ? "C:\\data\\app" : "/data/app"

describe("createStoragePaths", () => {
	test("defaults latestVersion from max versions/<n> on disk when omitted", () => {
		const root = mkdtempSync(join(tmpdir(), "paths-ver-"))
		try {
			mkdirSync(join(root, "versions", "1"), { recursive: true })
			mkdirSync(join(root, "versions", "2"), { recursive: true })
			const paths = createStoragePaths({ root })
			expect(paths.latestVersion).toBe(2)
			expect(paths.activeVersion).toBe(2)
			expect(paths.active.version).toBe(2)
			expect(paths.latest.version).toBe(2)
			expect(paths.active.root).toContain(`${sep()}versions${sep()}2`)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("rejects relative roots", () => {
		expect(() => createStoragePaths({ root: "relative/path" })).toThrow(
			/absolute path/,
		)
	})

	test("builds versions and local subtrees under the root", () => {
		const paths = createStoragePaths({ root: ROOT })
		expect(paths.active.root).toContain("versions")
		expect(paths.local.root).toContain("local")
		expect(paths.active.root).not.toBe(paths.local.root)
	})

	test("resource path nests under versions/resources/<id>", () => {
		const paths = createStoragePaths({ root: ROOT })
		const p = paths.active.resource("res_42")
		expect(p.endsWith(`resources${sep()}res_42`)).toBe(true)
		expect(p.startsWith(paths.active.root)).toBe(true)
	})

	test("version plugins nest under versions/<v>/plugins", () => {
		const paths = createStoragePaths({ root: ROOT })
		const p = paths.latest.plugins()
		expect(p.endsWith(`versions${sep()}1${sep()}plugins`)).toBe(true)
		expect(p.startsWith(paths.latest.root)).toBe(true)
		expect(p.startsWith(paths.local.root)).toBe(false)
	})

	test("upload staging root and pool nest under local/.tmp", () => {
		const paths = createStoragePaths({ root: ROOT })
		const root = paths.local.uploadStagingRoot()
		expect(root.endsWith(`${sep()}local${sep()}.tmp`)).toBe(true)
		expect(root.startsWith(paths.local.root)).toBe(true)
		const pool = paths.local.stagingPoolRoot()
		expect(pool.startsWith(`${root}${sep()}`)).toBe(true)
		const file = paths.local.stagingPoolFile(
			"550e8400-e29b-41d4-a716-446655440000",
			".png",
		)
		expect(file.startsWith(`${pool}${sep()}`)).toBe(true)
		expect(file.endsWith("550e8400-e29b-41d4-a716-446655440000.png")).toBe(true)
	})

	test("cache root nests under local/cache", () => {
		const paths = createStoragePaths({ root: ROOT })
		const cache = paths.local.cache()
		expect(cache.endsWith(`${sep()}local${sep()}cache`)).toBe(true)
		expect(cache.startsWith(paths.local.root)).toBe(true)
	})

	test("derived caches nest under local/cache, persistent dirs do not", () => {
		const paths = createStoragePaths({ root: ROOT })
		const cache = paths.local.cache()
		const derived = [
			paths.local.resource("res_1"),
			paths.local.character("char_1"),
			paths.local.resFilesCache("res_1"),
			paths.local.resFilePreviewDir("res_1"),
			paths.local.resVideoFrame("res_1", "clip.mp4", 1000),
			paths.local.resExtractedDir("res_1", 1),
			paths.local.resExtractedEntry("res_1", 1, "a/b.png"),
			paths.local.tmp(),
			paths.local.tmpFile("scratch.bin"),
		]
		for (const p of derived) {
			expect(p.startsWith(`${cache}${sep()}`)).toBe(true)
		}
		const persistent = [
			paths.local.trash(),
			paths.local.logs(),
			paths.local.sessionKey(),
			paths.local.uploadStagingRoot(),
			paths.local.stagingPoolRoot(),
		]
		for (const p of persistent) {
			expect(p.startsWith(`${cache}${sep()}`)).toBe(false)
			expect(p.startsWith(paths.local.root)).toBe(true)
		}
	})

	test("thumb path nests under local/cache/<kind>/<id>/<variant>.webp", () => {
		const paths = createStoragePaths({ root: ROOT })
		const r = paths.local.localCover("resource", "res_1", "preview", "webp")
		expect(r.endsWith(`resources${sep()}res_1${sep()}preview.webp`)).toBe(true)
		expect(r.startsWith(paths.local.cache())).toBe(true)
		const c = paths.local.localCover("character", "char_1", "avatar", "webp")
		expect(c.endsWith(`characters${sep()}char_1${sep()}avatar.webp`)).toBe(true)
		expect(c.startsWith(paths.local.cache())).toBe(true)
	})

	test("per-file variant cache basenames fold ext, key and flattened separators", () => {
		const paths = createStoragePaths({ root: ROOT })
		const variant = paths.local.resFileVariant(
			"res_1",
			"dir/page.jpg",
			"ab12cd34",
			"avif",
		)
		expect(variant).toMatch(/dir__page__jpg__[0-9a-f]{8}__ab12cd34\.avif$/)
		// Backslash names from odd archives are flattened the same way.
		const frame = paths.local.resVideoFrame("res_1", "sub\\clip.mp4", 1000)
		expect(frame).toMatch(/sub__clip__mp4__[0-9a-f]{8}[\\/]1000\.avif$/)
	})

	test("same-named files in nested folders never share a cache identity", () => {
		const paths = createStoragePaths({ root: ROOT })
		const a = paths.local.resFileVariant("res_1", "a/tex.png", "k1", "avif")
		const b = paths.local.resFileVariant("res_1", "b/tex.png", "k1", "avif")
		expect(a).not.toBe(b)
		// Same file, same spec: stable identity across calls.
		const again = paths.local.resFileVariant("res_1", "a/tex.png", "k1", "avif")
		expect(again).toBe(a)
	})

	test("flattening ambiguities are disambiguated by the path hash", () => {
		const paths = createStoragePaths({ root: ROOT })
		// Both flatten to `a__b__c__png`; only the hash tells them apart.
		const folderUnderscore = paths.local.resFileVariant(
			"res_1",
			"a__b/c.png",
			"k1",
			"avif",
		)
		const fileUnderscore = paths.local.resFileVariant(
			"res_1",
			"a/b__c.png",
			"k1",
			"avif",
		)
		expect(folderUnderscore).not.toBe(fileUnderscore)
	})

	test("extracted entries carry the same collision-free identity", () => {
		const paths = createStoragePaths({ root: ROOT })
		const first = paths.local.resExtractedEntry("res_1", 1, "a__b/c.png")
		const second = paths.local.resExtractedEntry("res_1", 1, "a/b__c.png")
		expect(first).not.toBe(second)
		expect(first).toMatch(/a__b__c__png__[0-9a-f]{8}$/)
	})

	test("imageVariantKey is a short stable hex digest", () => {
		const key = imageVariantKey("avif:inside:4000000:70:90")
		expect(key).toMatch(/^[0-9a-f]{8}$/)
		expect(imageVariantKey("avif:inside:4000000:70:90")).toBe(key)
		expect(imageVariantKey("webp:exact:4000000:70:90")).not.toBe(key)
	})

	test("rejects path-like ids to prevent directory traversal", () => {
		const paths = createStoragePaths({ root: ROOT })
		expect(() => paths.active.resource("../escape")).toThrow(/separators/)
		expect(() => paths.active.resource("../../etc/passwd")).toThrow(
			/separators/,
		)
		expect(() => paths.active.resource("a\\b")).toThrow(/separators/)
	})

	test("rejects Windows reserved basenames and trailing dot/space", () => {
		const paths = createStoragePaths({ root: ROOT })
		expect(() => paths.active.resource("CON")).toThrow(/reserved/)
		expect(() => paths.active.resource("prn.txt")).toThrow(/reserved/)
		expect(() => paths.active.resource("trailing.")).toThrow(/dot or space/)
		expect(() => paths.active.resource("trailing ")).toThrow(/dot or space/)
	})

	test("rejects empty and dot segments", () => {
		expect(() => assertSafeSegment("")).toThrow(/empty/)
		expect(() => assertSafeSegment(".")).toThrow(/'\.'/)
		expect(() => assertSafeSegment("..")).toThrow(/'\.\.'/)
	})

	test("rejects control characters", () => {
		expect(() => assertSafeSegment("nul\u0000byte")).toThrow(/disallowed/)
	})
})

describe("assertInside", () => {
	test("accepts descendants and the ancestor itself", () => {
		expect(assertInside(ROOT, ROOT)).toBe(ROOT)
		const descendant =
			process.platform === "win32"
				? `${ROOT}\\sub\\leaf.txt`
				: `${ROOT}/sub/leaf.txt`
		expect(assertInside(ROOT, descendant)).toBe(descendant)
	})

	test("rejects siblings that share a prefix", () => {
		const sibling =
			process.platform === "win32" ? `${ROOT}-other` : `${ROOT}-other`
		expect(() => assertInside(ROOT, sibling)).toThrow(/escapes/)
	})
})

function sep(): string {
	return process.platform === "win32" ? "\\" : "/"
}
