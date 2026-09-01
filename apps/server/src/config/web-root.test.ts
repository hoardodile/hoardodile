import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { resolveAppWebRoot } from "./web-root.ts"

describe("resolveAppWebRoot", () => {
	const dirs: string[] = []

	function tempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "hd-web-root-"))
		dirs.push(dir)
		return dir
	}

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test("returns the dir when it already contains index.html", () => {
		const dir = tempDir()
		writeFileSync(join(dir, "index.html"), "<!doctype html><html></html>")
		expect(resolveAppWebRoot(dir)).toBe(dir)
	})

	test("returns undefined when index.html is missing (partial build)", () => {
		const dir = tempDir()
		expect(resolveAppWebRoot(dir)).toBeUndefined()
	})

	test("returns undefined for a missing dir", () => {
		const dir = tempDir()
		expect(resolveAppWebRoot(join(dir, "no-such-build"))).toBeUndefined()
	})

	test("returns undefined when not configured", () => {
		expect(resolveAppWebRoot(undefined)).toBeUndefined()
		expect(resolveAppWebRoot("")).toBeUndefined()
	})
})
