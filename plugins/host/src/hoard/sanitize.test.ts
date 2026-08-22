import { describe, expect, test } from "vitest"
import {
	createOccupiedNames,
	occupyEntryName,
	sanitizeEntryName,
	uniqueEntryName,
} from "./sanitize.ts"

describe("sanitizeEntryName", () => {
	test("replaces Windows-forbidden characters with underscores", () => {
		expect(sanitizeEntryName('a<b>c:d"e|f?g*h')).toBe("a_b_c_d_e_f_g_h")
	})

	test("treats backslashes as separators", () => {
		expect(sanitizeEntryName("dir\\sub\\file.txt")).toBe("dir/sub/file.txt")
	})

	test("strips control characters", () => {
		expect(sanitizeEntryName("a\x01b\x1f.txt")).toBe("ab.txt")
	})

	test("rejects null bytes", () => {
		expect(sanitizeEntryName("a\u0000b")).toBeUndefined()
	})

	test("drops . and .. segments instead of escaping", () => {
		expect(sanitizeEntryName("../a/./b.txt")).toBe("a/b.txt")
		expect(sanitizeEntryName("../../etc/passwd")).toBe("etc/passwd")
	})

	test("strips leading dots (metadata namespace) and trailing dots/spaces", () => {
		expect(sanitizeEntryName(".hidden.txt")).toBe("hidden.txt")
		expect(sanitizeEntryName("...dots.txt")).toBe("dots.txt")
		expect(sanitizeEntryName("name.")).toBe("name")
		expect(sanitizeEntryName("name ")).toBe("name")
		expect(sanitizeEntryName("dir./file. ")).toBe("dir/file")
	})

	test("prefixes Windows reserved base names incl. extension variants", () => {
		expect(sanitizeEntryName("CON")).toBe("_CON")
		expect(sanitizeEntryName("con.txt")).toBe("_con.txt")
		expect(sanitizeEntryName("COM1")).toBe("_COM1")
		expect(sanitizeEntryName("LPT9.x")).toBe("_LPT9.x")
		expect(sanitizeEntryName("NUL")).toBe("_NUL")
		expect(sanitizeEntryName("CONIN$")).toBe("_CONIN$")
		expect(sanitizeEntryName("CONOUT$.txt")).toBe("_CONOUT$.txt")
		expect(sanitizeEntryName("COM0")).toBe("_COM0")
		expect(sanitizeEntryName("COM\u00b9")).toBe("_COM\u00b9")
		expect(sanitizeEntryName("LPT\u00b3.bin")).toBe("_LPT\u00b3.bin")
	})

	test("preserves subdirectory structure", () => {
		expect(sanitizeEntryName("Chapter 1/001.jpg")).toBe("Chapter 1/001.jpg")
	})

	test("normalizes to NFC", () => {
		const decomposed = "cafe\u0301.txt"
		expect(sanitizeEntryName(decomposed)).toBe("caf\u00e9.txt")
	})

	test("caps segments at 240 UTF-8 bytes", () => {
		const long = `${"中".repeat(200)}.txt`
		const result = sanitizeEntryName(long)
		expect(result).toBeDefined()
		const name = result!.split("/").at(-1)!
		expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(243)
		expect(name.includes("\uFFFD")).toBe(false)
	})

	test("caps emoji segments by bytes, not code units", () => {
		const long = "😀".repeat(200)
		const result = sanitizeEntryName(long)
		expect(result).toBeDefined()
		expect(Buffer.byteLength(result!, "utf8")).toBeLessThanOrEqual(240)
	})

	test("returns undefined for unusable names", () => {
		expect(sanitizeEntryName("")).toBeUndefined()
		expect(sanitizeEntryName("....")).toBeUndefined()
		expect(sanitizeEntryName("\u0000")).toBeUndefined()
		expect(sanitizeEntryName("///")).toBeUndefined()
	})

	test("rejects relative paths over the total length cap", () => {
		const segments = Array.from({ length: 300 }, () => "abc")
		expect(sanitizeEntryName(segments.join("/"))).toBeUndefined()
	})
})

describe("uniqueEntryName", () => {
	test("appends -N suffix on exact collisions", () => {
		const occupied = createOccupiedNames({ files: ["a.png"] })
		expect(uniqueEntryName(occupied, "a.png")).toBe("a-1.png")
		occupyEntryName(occupied, "a-1.png")
		expect(uniqueEntryName(occupied, "a.png")).toBe("a-2.png")
	})

	test("collides case-insensitively", () => {
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["A.PNG"] }), "a.png"),
		).toBe("a-1.png")
	})

	test("keeps the extension in the suffix", () => {
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["page.jpg"] }), "page.jpg"),
		).toBe("page-1.jpg")
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["page"] }), "page"),
		).toBe("page-1")
	})

	test("resolves file-vs-directory prefix collisions on the colliding segment", () => {
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["x"] }), "x/y.txt"),
		).toBe("x-1/y.txt")
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["a/b"] }), "a/b/c.txt"),
		).toBe("a/b-1/c.txt")
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["x", "x-1"] }), "x/y.txt"),
		).toBe("x-2/y.txt")
	})

	test("directory ancestors do not collide with nested entries", () => {
		const occupied = createOccupiedNames()
		occupyEntryName(occupied, "src/a.txt")
		expect(uniqueEntryName(occupied, "src/sub/b.txt")).toBe("src/sub/b.txt")
		expect(uniqueEntryName(occupied, "src/c.txt")).toBe("src/c.txt")
	})

	test("an installed file blocks the exact path of a later directory root", () => {
		const occupied = createOccupiedNames()
		occupyEntryName(occupied, "x/y.txt")
		expect(occupied.dirs.has("x")).toBe(true)
		expect(uniqueEntryName(occupied, "x")).toBe("x-1")
	})

	test("suffixing retries until the whole path is free", () => {
		const occupied = createOccupiedNames({ files: ["a.png", "a-1.png"] })
		expect(uniqueEntryName(occupied, "a.png")).toBe("a-2.png")
	})

	test("untouched names pass through", () => {
		expect(
			uniqueEntryName(createOccupiedNames({ files: ["other.png"] }), "a.png"),
		).toBe("a.png")
	})
})
