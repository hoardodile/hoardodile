/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	compareVersions,
	decideChannel,
	isResourcePackManifest,
	neededLayers,
	type ResourcePackManifest,
} from "./update-plan.ts"

const manifest = (
	overrides: Partial<ResourcePackManifest> = {},
): ResourcePackManifest => ({
	schema: 1,
	version: "1.2.0",
	platform: "win",
	arch: "x64",
	shellHash: "sha256:aaaa",
	electronVersion: "43.4.1",
	installedYaml: "nsis",
	marker: {
		schema: 1,
		version: "1.2.0",
		nodeVersion: "24.4.0",
		platform: "win",
		arch: "x64",
	},
	bundled: { node: "24.4.0", server: "1.2.0", plugins: ["gallery@1.0.0"] },
	layers: [
		{
			name: "node",
			identity: "sha256:nnnn",
			payload: { fileName: "layer-node.tar.gz", sha256: "n1", size: 1 },
		},
		{
			name: "server-dist",
			identity: "sha256:ssss",
			payload: { fileName: "layer-server-dist.tar.gz", sha256: "s1", size: 2 },
		},
		{
			name: "server-node_modules",
			identity: "sha256:mmmm",
			payload: { fileName: "layer-nm.tar.gz", sha256: "m1", size: 3 },
		},
		{
			name: "plugins",
			identity: "sha256:pppp",
			payload: { fileName: "layer-plugins.tar.gz", sha256: "p1", size: 4 },
		},
	],
	...overrides,
})

const local = (
	overrides: Partial<Parameters<typeof decideChannel>[1]> = {},
) => ({
	appVersion: "1.0.0",
	resourceVersion: null,
	shellHash: "sha256:aaaa",
	electronVersion: "43.4.1",
	...overrides,
})

const available = { available: true }

describe("compareVersions", () => {
	it("orders semver triples", () => {
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
		expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0)
		expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0)
		expect(compareVersions("2.0.0", "9.9.9")).toBeLessThan(0)
		// Prerelease strings are not X.Y.Z: they parse as 0.0.0, so any
		// plain release is "greater" — safe (never routes to an update).
		expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0)
	})
})

describe("decideChannel", () => {
	it("routes a same-shell release to the resource channel", () => {
		expect(decideChannel(manifest(), local(), available)).toBe("resources")
	})

	it("routes a shell change to the full channel", () => {
		expect(
			decideChannel(manifest({ shellHash: "sha256:bbbb" }), local(), available),
		).toBe("full")
	})

	it("routes an Electron bump to the full channel even with the same shell", () => {
		expect(
			decideChannel(
				manifest({ electronVersion: "44.0.0" }),
				local(),
				available,
			),
		).toBe("full")
	})

	it("returns none when the manifest is not newer than the application", () => {
		expect(
			decideChannel(manifest({ version: "1.0.0" }), local(), available),
		).toBe("none")
		expect(
			decideChannel(manifest({ version: "0.9.0" }), local(), available),
		).toBe("none")
	})

	it("compares against the applied resource version when it is newer", () => {
		const applied = local({ resourceVersion: "1.1.0" })
		expect(
			decideChannel(manifest({ version: "1.1.0" }), applied, available),
		).toBe("none")
		expect(
			decideChannel(manifest({ version: "1.2.0" }), applied, available),
		).toBe("resources")
	})

	it("can jump straight from an old shell to a same-hash release after skips", () => {
		// v1.1 (shell same), v1.2 (shell changed, skipped), v1.3 (shell same
		// as 1.0) — the resource pack applies because the shell hash is an
		// absolute identity, not a diff.
		expect(
			decideChannel(
				manifest({ version: "1.3.0" }),
				local({ resourceVersion: "1.1.0" }),
				available,
			),
		).toBe("resources")
	})

	it("falls back to full when the channel is disabled for this install", () => {
		expect(decideChannel(manifest(), local(), { available: false })).toBe(
			"full",
		)
	})

	it("falls back to full when the local shell hash is unknown", () => {
		expect(
			decideChannel(manifest(), local({ shellHash: undefined }), available),
		).toBe("full")
	})
})

describe("neededLayers", () => {
	it("downloads only mismatching layers and copies the rest", () => {
		const { download, copy } = neededLayers(manifest(), {
			node: "sha256:nnnn",
			"server-dist": "sha256:different",
			"server-node_modules": "sha256:mmmm",
			plugins: "sha256:pppp",
		})
		expect(download.map((layer) => layer.name)).toEqual(["server-dist"])
		expect(copy.map((layer) => layer.name)).toEqual([
			"node",
			"server-node_modules",
			"plugins",
		])
	})

	it("downloads everything when no identity matches", () => {
		const { download, copy } = neededLayers(manifest(), {
			node: undefined,
			"server-dist": undefined,
			"server-node_modules": undefined,
			plugins: undefined,
		})
		expect(download).toHaveLength(4)
		expect(copy).toHaveLength(0)
	})

	it("copies everything when all identities match", () => {
		const { download, copy } = neededLayers(manifest(), {
			node: "sha256:nnnn",
			"server-dist": "sha256:ssss",
			"server-node_modules": "sha256:mmmm",
			plugins: "sha256:pppp",
		})
		expect(download).toHaveLength(0)
		expect(copy).toHaveLength(4)
	})

	it("treats an unhashable (missing) layer as a download", () => {
		const { download } = neededLayers(manifest(), {
			node: "sha256:nnnn",
			"server-dist": undefined,
			"server-node_modules": "sha256:mmmm",
			plugins: "sha256:pppp",
		})
		expect(download.map((layer) => layer.name)).toEqual(["server-dist"])
	})
})

describe("isResourcePackManifest", () => {
	it("accepts the canonical shape", () => {
		expect(isResourcePackManifest(manifest())).toBe(true)
	})

	it("rejects malformed payloads", () => {
		expect(isResourcePackManifest(null)).toBe(false)
		expect(isResourcePackManifest({ schema: 2 })).toBe(false)
		expect(
			isResourcePackManifest({
				...manifest(),
				marker: undefined,
			} as unknown),
		).toBe(false)
		expect(
			isResourcePackManifest({
				...manifest(),
				layers: [{ name: "node" }],
			} as unknown),
		).toBe(false)
		expect(
			isResourcePackManifest({
				...manifest(),
				electronVersion: 42,
			} as unknown),
		).toBe(false)
		expect(isResourcePackManifest(manifest({ layers: [] }))).toBe(false)
	})
})
