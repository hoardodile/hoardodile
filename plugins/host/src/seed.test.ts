import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { seedPlugins } from "./seed.ts"

const PLUGIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function writePlugin(dir: string, name: string, extra?: string): void {
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify({
			id: PLUGIN_ID,
			name,
			description: "",
			version: "1.0.0",
			permissions: {},
		}),
	)
	writeFileSync(join(dir, "main.js"), extra ?? "export default {}\n")
}

describe("seedPlugins", () => {
	let root: string
	let pluginsDir: string
	let seedDir: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "plugin-seed-"))
		pluginsDir = join(root, "plugins")
		seedDir = join(root, "seed")
		mkdirSync(pluginsDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("skips an identical installed copy without changing mtime", () => {
		writePlugin(join(seedDir, "plugin"), "same")
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		const dest = join(pluginsDir, PLUGIN_ID, "main.js")
		const before = statSync(dest).mtimeMs
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		expect(statSync(dest).mtimeMs).toBe(before)
	})

	test("replaces the destination when content changes", () => {
		writePlugin(join(seedDir, "plugin"), "old", "old\n")
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		writePlugin(join(seedDir, "plugin"), "new", "new\n")
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		expect(
			JSON.parse(
				readFileSync(join(pluginsDir, PLUGIN_ID, "manifest.json"), "utf-8"),
			).name,
		).toBe("new")
		expect(readFileSync(join(pluginsDir, PLUGIN_ID, "main.js"), "utf-8")).toBe(
			"new\n",
		)
	})
})
