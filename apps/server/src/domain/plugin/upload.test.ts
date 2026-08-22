import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildPluginUploads } from "./upload.ts"

const PLUGIN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

const MANIFEST = JSON.stringify({
	id: PLUGIN_ID,
	name: "test-plugin",
	description: "test",
	version: "0.0.0",
	permissions: {},
})

describe("buildPluginUploads", () => {
	let root: string
	let pluginsDir: string
	let stagingRoot: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "plugin-upload-test-"))
		pluginsDir = join(root, "plugins")
		stagingRoot = join(root, "staging")
		mkdirSync(pluginsDir, { recursive: true })
		mkdirSync(stagingRoot, { recursive: true })
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	function uploadsWith(
		extractArchive: PluginUploadsExtract,
	): ReturnType<typeof buildPluginUploads> {
		return buildPluginUploads({
			stagingRoot,
			maxExtractedBytes: 1024,
			extractArchive,
			commit: async (stagingDir, id) => {
				const { rename } = await import("node:fs/promises")
				await rename(stagingDir, join(pluginsDir, id))
			},
		})
	}

	test("installs a valid plugin zip into the commit destination", async () => {
		const uploads = uploadsWith(async (_source, destDir) => {
			await writeFile(join(destDir, "manifest.json"), MANIFEST)
		})

		const id = await uploads.installFromZip(Readable.from(["zip-bytes"]))
		expect(id).toBe(PLUGIN_ID)
		expect(existsSync(join(pluginsDir, PLUGIN_ID, "manifest.json"))).toBe(true)
		expect(
			readdirSync(stagingRoot).filter((n) => n.startsWith("plugin-extract-")),
		).toEqual([])
		expect(
			readdirSync(pluginsDir).filter((n) => n.startsWith(".staging-")),
		).toEqual([])
	})

	test("forwards maxExtractedBytes and cleans the staging dir on failure", async () => {
		let seenBudget = 0
		const uploads = uploadsWith((_source, _destDir, opts) => {
			seenBudget = opts.maxBytes
			return Promise.reject(new Error("archive extracts to more than N bytes"))
		})

		await expect(
			uploads.installFromZip(Readable.from(["zip-bytes"])),
		).rejects.toThrow("archive extracts to more than")
		expect(seenBudget).toBe(1024)
		expect(readdirSync(pluginsDir)).toEqual([])
		expect(readdirSync(stagingRoot)).toEqual([])
	})

	test("rejects a zip without a root manifest.json", async () => {
		const uploads = uploadsWith(async () => {})

		await expect(
			uploads.installFromZip(Readable.from(["zip-bytes"])),
		).rejects.toThrow("manifest.json")
		expect(readdirSync(pluginsDir)).toEqual([])
		expect(readdirSync(stagingRoot)).toEqual([])
	})
})

type PluginUploadsExtract = (
	source: NodeJS.ReadableStream,
	destDir: string,
	opts: { readonly maxBytes: number },
) => Promise<void>
