/**
 * @vitest-environment node
 */

import { zipSync } from "fflate"
import { describe, expect, test } from "vitest"
import { readPluginZipManifest } from "./plugin-zip-preview"

const MANIFEST = {
	id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	name: "test-plugin",
	description: "test",
	version: "0.0.0",
	permissions: { message: true },
}

function zipWith(entries: Record<string, Uint8Array>): File {
	const zipped = zipSync(entries)
	return new File([zipped], "plugin.zip", { type: "application/zip" })
}

function manifestBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value))
}

describe("readPluginZipManifest", () => {
	test("returns the validated manifest from a plugin zip", async () => {
		const file = zipWith({
			"manifest.json": manifestBytes(MANIFEST),
			"main.js": new TextEncoder().encode("export default {}"),
			"assets/logo.svg": new Uint8Array([1, 2, 3]),
		})

		const manifest = await readPluginZipManifest(file)
		expect(manifest.id).toBe(MANIFEST.id)
		expect(manifest.name).toBe("test-plugin")
		expect(manifest.permissions.message).toBe(true)
		// undeclared permissions default to false
		expect(manifest.permissions.sourceMeta).toBe(false)
	})

	test("rejects when manifest.json is missing at the zip root", async () => {
		const file = zipWith({
			"main.js": new TextEncoder().encode("export default {}"),
			"sub/manifest.json": manifestBytes(MANIFEST),
		})
		await expect(readPluginZipManifest(file)).rejects.toThrow("manifest.json")
	})

	test("rejects a file that is not a zip archive", async () => {
		const file = new File([new Uint8Array([0, 1, 2, 3, 4])], "plugin.zip")
		await expect(readPluginZipManifest(file)).rejects.toThrow("not a zip")
	})

	test("rejects a manifest that is not valid JSON", async () => {
		const file = zipWith({
			"manifest.json": new TextEncoder().encode("{nope"),
		})
		await expect(readPluginZipManifest(file)).rejects.toThrow("not valid JSON")
	})

	test("rejects a manifest that fails schema validation", async () => {
		const file = zipWith({
			"manifest.json": manifestBytes({ ...MANIFEST, id: "not-a-uuid" }),
		})
		await expect(readPluginZipManifest(file)).rejects.toThrow("validation")
	})
})
