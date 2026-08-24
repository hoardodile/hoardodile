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

	test("the host-managed vault survives a reseeding replacement", () => {
		writePlugin(join(seedDir, "plugin"), "old")
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		// The plugin downloaded an asset into its vault.
		const vaultDir = join(pluginsDir, PLUGIN_ID, "vault")
		mkdirSync(vaultDir, { recursive: true })
		writeFileSync(join(vaultDir, "runtime.mjs"), "export const x = 1\n")
		// Session 2: the source changed (an app update) → the tree is
		// replaced, the vault must stay (vault files are host data).
		writePlugin(join(seedDir, "plugin"), "new")
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		expect(
			readFileSync(
				join(pluginsDir, PLUGIN_ID, "vault", "runtime.mjs"),
				"utf-8",
			),
		).toBe("export const x = 1\n")
	})

	test("an unchanged tree with a vault is left untouched (fingerprint ignores vault)", () => {
		writePlugin(join(seedDir, "plugin"), "same")
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		const vaultDir = join(pluginsDir, PLUGIN_ID, "vault")
		mkdirSync(vaultDir, { recursive: true })
		writeFileSync(join(vaultDir, "runtime.mjs"), "export const x = 1\n")
		const before = statSync(join(pluginsDir, PLUGIN_ID, "main.js")).mtimeMs
		seedPlugins(pluginsDir, [join(seedDir, "plugin")])
		expect(statSync(join(pluginsDir, PLUGIN_ID, "main.js")).mtimeMs).toBe(
			before,
		)
	})
})
