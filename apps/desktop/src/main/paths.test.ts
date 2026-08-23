/**
 * @vitest-environment node
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { packagedLayout, workspaceLayout } from "./paths.ts"

describe("packagedLayout", () => {
	it("points the sidecar at extraResources trees", () => {
		const resources = join("C:", "app", "resources")
		const layout = packagedLayout(resources)
		expect(layout.packaged).toBe(true)
		expect(layout.nodePath).toBe(join(resources, "node", "node.exe"))
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
		const workspaceRoot = join("C:", "repo")
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
