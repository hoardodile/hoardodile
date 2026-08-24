/**
 * @vitest-environment node
 *
 * The two hashers — this TS implementation and the build-side mjs one —
 * must stay byte-identical (the client hashes the installed asar, the
 * build hashes out/; equality is what routes a release to the resource
 * channel). This test runs BOTH against the same fixture and asserts
 * equality, so any drift breaks immediately instead of silently forcing
 * full updates forever.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { contentHashTree as buildHash } from "../../../../scripts/lib/shell-hash.mjs"
import { contentHashTree } from "./shell-hash.ts"

const scratch: string[] = []

afterEach(() => {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function fixtureTree(): string {
	const root = join(mkdtempSync(join(tmpdir(), "hd-shell-hash-")), "out")
	mkdirSync(join(root, "main"), { recursive: true })
	mkdirSync(join(root, "preload"), { recursive: true })
	writeFileSync(join(root, "main", "index.js"), 'console.log("hi")')
	writeFileSync(join(root, "preload", "index.js"), "pre")
	writeFileSync(join(root, "README.txt"), "zz")
	scratch.push(join(root, ".."))
	return root
}

describe("contentHashTree", () => {
	it("matches the build-side hasher byte-for-byte", async () => {
		const root = fixtureTree()
		expect(contentHashTree(root)).toBe(await buildHash(root))
	})

	it("matches the build-side hasher with excludePrefixes", async () => {
		const root = fixtureTree()
		const excludes = ["main"]
		expect(contentHashTree(root, { excludePrefixes: excludes })).toBe(
			await buildHash(root, { excludePrefixes: excludes }),
		)
	})

	it("excludes exact prefixes and their subtrees", () => {
		const root = fixtureTree()
		const full = contentHashTree(root)
		const withoutMain = contentHashTree(root, { excludePrefixes: ["main"] })
		expect(withoutMain).not.toBe(full)
		// The whole subtree is excluded: a change under main/ must not
		// touch the excluded hash.
		writeFileSync(join(root, "main", "extra.js"), "x")
		expect(contentHashTree(root, { excludePrefixes: ["main"] })).toBe(
			withoutMain,
		)
	})

	it("is deterministic", () => {
		const root = fixtureTree()
		expect(contentHashTree(root)).toBe(contentHashTree(root))
	})

	it("changes when any file content changes", () => {
		const root = fixtureTree()
		const before = contentHashTree(root)
		writeFileSync(join(root, "main", "index.js"), 'console.log("bye")')
		expect(contentHashTree(root)).not.toBe(before)
	})

	it("changes when the relative path changes", () => {
		const root = fixtureTree()
		const before = contentHashTree(root)
		rmSync(join(root, "README.txt"))
		writeFileSync(join(root, "OTHER.txt"), "zz")
		expect(contentHashTree(root)).not.toBe(before)
	})

	it("throws on a missing root", () => {
		expect(() =>
			contentHashTree(join(tmpdir(), "definitely-missing")),
		).toThrow()
	})
})
