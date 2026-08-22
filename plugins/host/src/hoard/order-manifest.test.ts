import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	ORDER_MANIFEST_NAME,
	orderEntries,
	parseOrderManifest,
	readOrderManifest,
	writeOrderManifest,
} from "./order-manifest.ts"

const tempDirs: string[] = []

async function withTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "order-manifest-"))
	tempDirs.push(dir)
	return dir
}

afterEach(async () => {
	for (const dir of tempDirs) {
		await rm(dir, { recursive: true, force: true }).catch(() => {})
	}
	tempDirs.length = 0
})

describe("writeOrderManifest / readOrderManifest", () => {
	test("round-trips the manifest", async () => {
		const dir = await withTempDir()
		await writeOrderManifest(dir, ["b.png", "a.png", "sub/c.png"])
		expect(await readOrderManifest(dir)).toEqual([
			"b.png",
			"a.png",
			"sub/c.png",
		])
		expect(await readFile(join(dir, ORDER_MANIFEST_NAME), "utf8")).toBe(
			JSON.stringify(["b.png", "a.png", "sub/c.png"]),
		)
	})

	test("missing manifest resolves to undefined", async () => {
		const dir = await withTempDir()
		expect(await readOrderManifest(dir)).toBeUndefined()
	})

	test("corrupt manifest resolves to undefined", async () => {
		const dir = await withTempDir()
		await writeFile(join(dir, ORDER_MANIFEST_NAME), "not json {")
		expect(await readOrderManifest(dir)).toBeUndefined()
	})
})

describe("parseOrderManifest", () => {
	test("rejects non-array bodies", () => {
		expect(parseOrderManifest('{"a":1}')).toBeUndefined()
		expect(parseOrderManifest('"a"')).toBeUndefined()
		expect(parseOrderManifest("42")).toBeUndefined()
	})

	test("rejects empty arrays", () => {
		expect(parseOrderManifest("[]")).toBeUndefined()
	})

	test("rejects non-string entries", () => {
		expect(parseOrderManifest('["a", 2]')).toBeUndefined()
	})

	test("rejects unsafe paths", () => {
		expect(parseOrderManifest('["../escape"]')).toBeUndefined()
		expect(parseOrderManifest('["a/../../b"]')).toBeUndefined()
		expect(parseOrderManifest('["/abs"]')).toBeUndefined()
		expect(parseOrderManifest('["a\\\\b"]')).toBeUndefined()
		expect(parseOrderManifest('["a//b"]')).toBeUndefined()
		expect(parseOrderManifest('[""]')).toBeUndefined()
		expect(parseOrderManifest('["a\\u0000b"]')).toBeUndefined()
	})

	test("accepts nested relative paths", () => {
		expect(parseOrderManifest('["a/b/c.png", "d.png"]')).toEqual([
			"a/b/c.png",
			"d.png",
		])
	})
})

describe("orderEntries", () => {
	const listed = ["a.png", "b.png", "c.png", "d.png"]

	test("reorders by the manifest and appends the rest naturally", () => {
		expect(orderEntries(["c.png", "a.png"], listed)).toEqual([
			"c.png",
			"a.png",
			"b.png",
			"d.png",
		])
	})

	test("ignores the manifest when an entry is missing from the listing", () => {
		expect(orderEntries(["a.png", "gone.png"], listed)).toBeUndefined()
	})

	test("ignores the manifest on duplicate entries", () => {
		expect(orderEntries(["a.png", "a.png"], listed)).toBeUndefined()
	})

	test("full manifest yields exactly the manifest order", () => {
		expect(orderEntries(["d.png", "c.png", "b.png", "a.png"], listed)).toEqual([
			"d.png",
			"c.png",
			"b.png",
			"a.png",
		])
	})
})
