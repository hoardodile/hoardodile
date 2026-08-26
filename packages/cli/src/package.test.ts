import { createHash } from "node:crypto"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unzipSync } from "fflate"
import { afterEach, describe, expect, test } from "vitest"
import { packPlugin } from "./package.ts"

const PLUGIN_ID = "33333333-3333-4333-8333-333333333333"

const MANIFEST = JSON.stringify({
	id: PLUGIN_ID,
	name: "Pack Fixture",
	description: "CLI package test fixture",
	version: "1.2.3-beta.1",
	permissions: {
		sourceMeta: true,
		searchMeta: false,
		danmaku: false,
		message: false,
	},
})

const roots: string[] = []

function makePlugin(opts?: { readonly withRepository?: boolean }): string {
	const root = mkdtempSync(join(tmpdir(), "cli-package-test-"))
	roots.push(root)
	const pluginDir = join(root, "plugin")
	mkdirSync(pluginDir, { recursive: true })
	writeFileSync(join(pluginDir, "manifest.json"), MANIFEST)
	const distDir = join(pluginDir, "dist")
	const assetsDir = join(distDir, "assets")
	mkdirSync(assetsDir, { recursive: true })
	writeFileSync(join(distDir, "index.html"), "<!doctype html><main></main>")
	writeFileSync(join(distDir, "main.js"), "export default {}")
	writeFileSync(join(assetsDir, "note.txt"), "nested asset")
	writeFileSync(join(distDir, "manifest.json"), MANIFEST)
	if (opts?.withRepository === true) {
		writeFileSync(
			join(pluginDir, "package.json"),
			JSON.stringify({
				name: "pack-fixture",
				repository: {
					type: "git",
					url: "git+https://github.com/me/pack-fixture.git",
				},
			}),
		)
	}
	return pluginDir
}

function textEntry(files: ReturnType<typeof unzipSync>, name: string): string {
	const bytes = files[name]
	expect(bytes).toBeDefined()
	return new TextDecoder().decode(bytes)
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true })
	roots.length = 0
})

describe("packPlugin", () => {
	test("zips dist/ contents with manifest.json at the zip root", async () => {
		const pluginDir = makePlugin()

		const result = await packPlugin(pluginDir, { skipBuild: true })

		expect(result.id).toBe(PLUGIN_ID)
		expect(result.version).toBe("1.2.3-beta.1")
		expect(result.zipPath.endsWith(`${PLUGIN_ID}-1.2.3-beta.1.zip`)).toBe(true)
		expect(existsSync(result.zipPath)).toBe(true)

		const files = unzipSync(readFileSync(result.zipPath))
		// Entries are flat: no wrapping directory, no backslashes.
		expect(Object.keys(files).sort()).toEqual(
			["assets/note.txt", "index.html", "main.js", "manifest.json"].sort(),
		)
		expect(Object.keys(files).every((name) => !name.includes("\\"))).toBe(true)
		expect(JSON.parse(textEntry(files, "manifest.json")).id).toBe(PLUGIN_ID)
	})

	test("prints a paste-ready registry line derived from package.json", async () => {
		const pluginDir = makePlugin({ withRepository: true })

		const result = await packPlugin(pluginDir, { skipBuild: true })

		expect(result.registryLine).toBe('"https://github.com/me/pack-fixture"')
	})

	test("falls back to a placeholder registry line without package.json", async () => {
		const pluginDir = makePlugin()

		const result = await packPlugin(pluginDir, { skipBuild: true })

		expect(result.registryLine).toBe('"https://github.com/<owner>/<repo>"')
	})

	test("writes the zip plus a sha256 sidecar", async () => {
		const pluginDir = makePlugin()

		const result = await packPlugin(pluginDir, { skipBuild: true })

		expect(result.sha256Path).toBe(`${result.zipPath}.sha256`)
		expect(existsSync(result.sha256Path)).toBe(true)
		const zipBytes = readFileSync(result.zipPath)
		expect(readFileSync(result.sha256Path, "utf-8")).toBe(
			`${createHash("sha256").update(zipBytes).digest("hex")}\n`,
		)
	})

	test("hints at the CI release workflow instead of a local gh command", async () => {
		const pluginDir = makePlugin()

		const result = await packPlugin(pluginDir, { skipBuild: true })

		expect(result.publishHint).toContain("push a tag v1.2.3-beta.1")
		expect(result.publishHint).toContain("release.yml")
	})

	test("requires dist/manifest.json when skipping the build", async () => {
		const root = mkdtempSync(join(tmpdir(), "cli-package-test-"))
		roots.push(root)
		const pluginDir = join(root, "plugin")
		mkdirSync(pluginDir, { recursive: true })
		writeFileSync(join(pluginDir, "manifest.json"), MANIFEST)

		await expect(packPlugin(pluginDir, { skipBuild: true })).rejects.toThrow(
			/dist\/manifest\.json not found/,
		)
	})

	test("packing twice overwrites the artifact instead of duplicating entries", async () => {
		const pluginDir = makePlugin()

		await packPlugin(pluginDir, { skipBuild: true })
		await packPlugin(pluginDir, { skipBuild: true })

		const releaseDir = join(pluginDir, "release")
		expect(
			readdirSync(releaseDir).filter((n) => n.endsWith(".zip")),
		).toHaveLength(1)
	})
})
