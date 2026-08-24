/**
 * @vitest-environment node
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
	discoverSeedPluginDirs,
	findWorkspaceRoot,
	packagedLayout,
	workspaceLayout,
} from "./paths.ts"

const MANIFEST = JSON.stringify({
	id: "00000000-0000-4000-8000-000000000000",
	name: "Test",
	description: "Test",
	version: "1.0.0",
	permissions: {},
})

describe("discoverSeedPluginDirs", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hd-seed-scan-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	it("finds every plugin dir with a manifest, skipping file and template", () => {
		for (const slug of ["file", "gallery", "pdf", "template", "notes"]) {
			mkdirSync(join(root, slug), { recursive: true })
			writeFileSync(join(root, slug, "manifest.json"), MANIFEST)
		}
		mkdirSync(join(root, "not-a-plugin"), { recursive: true })
		writeFileSync(join(root, "not-a-plugin", "README.md"), "x")

		expect(discoverSeedPluginDirs(root)).toEqual([
			join(root, "gallery"),
			join(root, "notes"),
			join(root, "pdf"),
		])
	})

	it("resolves the dist variant of the workspace layout", () => {
		for (const slug of ["file", "gallery", "pdf", "template"]) {
			mkdirSync(join(root, slug, "dist"), { recursive: true })
			writeFileSync(join(root, slug, "dist", "manifest.json"), MANIFEST)
		}
		const seen = discoverSeedPluginDirs(root, "dist")
		expect(seen).toEqual([
			join(root, "gallery", "dist"),
			join(root, "pdf", "dist"),
		])
	})

	it("returns an empty list when the root is missing", () => {
		expect(discoverSeedPluginDirs(join(root, "nope"))).toEqual([])
	})
})

describe("packagedLayout", () => {
	let resources: string

	beforeEach(() => {
		resources = mkdtempSync(join(tmpdir(), "hd-pkg-"))
		const pluginsDir = join(resources, "plugins")
		for (const slug of ["file", "gallery", "pdf"]) {
			mkdirSync(join(pluginsDir, slug), { recursive: true })
			writeFileSync(join(pluginsDir, slug, "manifest.json"), MANIFEST)
		}
	})

	afterEach(() => {
		rmSync(resources, { recursive: true, force: true })
	})

	it("points the sidecar at extraResources trees and discovers seeds", () => {
		const layout = packagedLayout(resources)
		expect(layout.packaged).toBe(true)
		expect(layout.nodePath).toBe(
			join(
				resources,
				"node",
				process.platform === "win32" ? "node.exe" : "node",
			),
		)
		expect(layout.serverArgs).toEqual([
			"--enable-source-maps",
			join(resources, "server", "main.js"),
		])
		expect(layout.cwd).toBe(join(resources, "server"))
		expect(layout.builtinPath).toBe(join(resources, "plugins", "file"))
		expect(layout.seedPluginPaths).toEqual([
			join(resources, "plugins", "gallery"),
			join(resources, "plugins", "pdf"),
		])
		expect(layout.webRoot).toBeUndefined()
	})
})

describe("workspaceLayout", () => {
	it("runs vite-node from apps/server so the src alias resolves", () => {
		const workspaceRoot = findWorkspaceRoot(fileURLToPath(import.meta.url))
		const viteNodeCli = join(
			workspaceRoot,
			"node_modules",
			"vite-node",
			"dist",
			"cli.mjs",
		)
		const layout = workspaceLayout({
			workspaceRoot,
			nodePath: "node",
			viteNodeCli,
		})
		expect(layout.packaged).toBe(false)
		expect(layout.cwd).toBe(join(workspaceRoot, "apps", "server"))
		expect(layout.serverArgs).toEqual([viteNodeCli, "src/main.ts"])
		expect(layout.builtinPath).toBe(
			join(workspaceRoot, "plugins", "file", "dist"),
		)
		// Discovered from plugins/*/dist — the dev workspace ships gallery
		// and pdf built dists; file and template are excluded by design.
		expect(layout.seedPluginPaths).toEqual([
			join(workspaceRoot, "plugins", "gallery", "dist"),
			join(workspaceRoot, "plugins", "pdf", "dist"),
		])
		// On this machine apps/web/dist exists only if the SPA has been
		// built; the dev LAN flow needs it (or the sidecar 404s at `/`).
		const distExists = existsSync(
			join(workspaceRoot, "apps", "web", "dist", "index.html"),
		)
		expect(layout.webRoot).toBe(
			distExists ? join(workspaceRoot, "apps", "web", "dist") : undefined,
		)
	})
})
