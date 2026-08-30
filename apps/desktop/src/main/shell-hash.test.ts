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
import {
	contentHashTree as buildHash,
	SHELL_HASH_BOUNDARY,
} from "../../../../scripts/lib/shell-hash.mjs"
import { contentHashTree, installedShellHash } from "./shell-hash.ts"

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
	mkdirSync(join(root, "wizard"), { recursive: true })
	writeFileSync(join(root, "main", "index.js"), 'console.log("hi")')
	writeFileSync(join(root, "main", "index.js.map"), "map-main")
	writeFileSync(join(root, "preload", "index.cjs"), "pre")
	writeFileSync(join(root, "wizard", "index.html"), "<html>wizard</html>")
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

	it("matches the build-side hasher with excludeExtensions", async () => {
		const root = fixtureTree()
		const options = { excludeExtensions: [".map"] }
		expect(contentHashTree(root, options)).toBe(await buildHash(root, options))
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

	it("ignores .map files even when their content changes", () => {
		const root = fixtureTree()
		const opts = { excludeExtensions: [".map"] }
		const before = contentHashTree(root, opts)
		writeFileSync(join(root, "main", "index.js.map"), "changed-map")
		expect(contentHashTree(root, opts)).toBe(before)
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

describe("installedShellHash", () => {
	it("roots the shell hash on the runtime boundary, excluding wizard and .map", () => {
		const root = fixtureTree() // out/{main,preload,wizard} + .map files
		// Exclude the wizard subtree: a change to it must not change the hash.
		const before = installedShellHash(root)
		writeFileSync(join(root, "wizard", "index.html"), "changed")
		expect(installedShellHash(root)).toBe(before)
		// A sourcemap change must be ignored too.
		writeFileSync(join(root, "main", "index.js.map"), "changed-map")
		expect(installedShellHash(root)).toBe(before)
		// A real shell runtime change must still flip the hash.
		writeFileSync(join(root, "main", "index.js"), 'console.log("bye")')
		expect(installedShellHash(root)).not.toBe(before)
	})

	it("returns undefined when the shell layout is not a packaged asar", () => {
		const root = join(mkdtempSync(join(tmpdir(), "hd-shell-hash-")), "out")
		mkdirSync(root, { recursive: true })
		scratch.push(join(root, ".."))
		expect(installedShellHash(root)).toBeUndefined()
	})
})

describe("shell-hash boundary", () => {
	it("agrees with the installed client hash", async () => {
		const root = fixtureTree()
		// The release manifest's shellHash (build) must equal what the
		// packaged client recomputes via installedShellHash; the v0.1.5
		// regression computed one side without the boundary, misrouting a
		// content release to the full updater.
		expect(await buildHash(root, SHELL_HASH_BOUNDARY)).toBe(
			installedShellHash(root),
		)
	})

	it("is non-trivial (excludes the wizard subtree and .map files)", async () => {
		const root = fixtureTree()
		// Reproduces the exact condition that broke the release: a boundary
		// hash differs from a whole-tree hash, so a consumer that forgets
		// the boundary silently diverges from the manifest/client.
		expect(await buildHash(root, SHELL_HASH_BOUNDARY)).not.toBe(
			await buildHash(root),
		)
	})
})
