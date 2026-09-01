import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveSource, resourceRootSource } from "./dev.ts"
import { CliError } from "./runner.ts"

/**
 * Guards the `--resource-dir` data source ("folder of resources"): each
 * direct subfolder is one resource, `apiFor` resolves only a real
 * subfolder (never escapes the root), and the source flags are mutually
 * exclusive with `--data`/`--storage`.
 */

function makeResourceRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "cli-res-"))
	for (const name of ["alpha", "beta"]) {
		mkdirSync(join(root, name))
		writeFileSync(join(root, name, "entry.txt"), `${name}-entry`)
	}
	writeFileSync(join(root, "loose.txt"), "loose")
	return root
}

describe("resourceRootSource", () => {
	it("lists each direct subfolder as a resource named by its basename, ignoring loose root files", () => {
		const root = makeResourceRoot()
		try {
			const source = resourceRootSource(root)
			expect(source.list()).toEqual([
				{ id: "alpha", name: "alpha" },
				{ id: "beta", name: "beta" },
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("resolves apiFor to a per-subfolder container for a real resource", async () => {
		const root = makeResourceRoot()
		try {
			const source = resourceRootSource(root)
			const api = source.apiFor("alpha")
			expect(api).toBeDefined()
			const files = [...(await api!.listFileNames())].sort()
			expect(files).toEqual(["entry.txt"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("returns undefined for a missing or escaping resource id", () => {
		const root = makeResourceRoot()
		try {
			const source = resourceRootSource(root)
			expect(source.apiFor("missing")).toBeUndefined()
			expect(source.apiFor("..")).toBeUndefined()
			expect(source.apiFor("alpha/../../x")).toBeUndefined()
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("resolveSource flag exclusivity", () => {
	it("throws when --resource-dir is combined with --data", () => {
		expect(() =>
			resolveSource({
				pluginDir: "/tmp/plugin",
				resourceRootDir: "/tmp/root",
				dataDir: "/tmp/data",
				port: 5199,
			}),
		).toThrow(CliError)
	})

	it("throws when --resource-dir is combined with --storage", () => {
		expect(() =>
			resolveSource({
				pluginDir: "/tmp/plugin",
				resourceRootDir: "/tmp/root",
				storageDir: "/tmp/storage",
				port: 5199,
			}),
		).toThrow(CliError)
	})

	it("selects the resource-root source when only --resource-dir is set", () => {
		const root = makeResourceRoot()
		try {
			const source = resolveSource({
				pluginDir: root,
				resourceRootDir: root,
				port: 5199,
			})
			expect(source).toBeDefined()
			expect(source!.list()[0]?.name).toBe("alpha")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
