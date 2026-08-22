import type { PluginManifestId } from "@hoardodile/sdk-types"
import { describe, expect, test, vi } from "vitest"
import type { PluginRegistry } from "./api-types.ts"
import { createPluginHooks } from "./hooks.ts"
import { buildRegistry } from "./loader.ts"
import type { PluginDefinition, ResourceAPI } from "./types.ts"

const PAGES_ID = "11111111-1111-4111-8111-111111111111" as PluginManifestId
const GALLERY_ID = "22222222-2222-4222-8222-222222222222" as PluginManifestId
const FILE_BUILTIN_ID =
	"33333333-3333-4333-8333-333333333333" as PluginManifestId

function manifestFor(
	id: PluginManifestId,
	name: string,
	permissions: Partial<{
		sourceMeta: boolean
		searchMeta: boolean
		danmaku: boolean
		message: boolean
		imageHashes: boolean
	}> = {},
) {
	return {
		id,
		name,
		description: "",
		version: "1.0.0",
		permissions: {
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
			...permissions,
		},
	}
}

function createPagesPlugin(): PluginDefinition {
	return {
		detect: async (api: ResourceAPI) => {
			const files = await api.listFileNames()
			if (files.length < 2) return { ok: false, reasons: ["page-image"] }
			const allImages = files.every((name) =>
				/\.(jpg|jpeg|png|webp|gif)$/i.test(name),
			)
			return allImages ? { ok: true } : { ok: false, reasons: ["page-image"] }
		},
	}
}

function createGalleryPlugin(): PluginDefinition {
	return {
		detect: async (api: ResourceAPI) => {
			const files = await api.listFileNames()
			const hasImage = files.some((name) =>
				/\.(jpg|jpeg|png|webp|gif)$/i.test(name),
			)
			return hasImage ? { ok: true } : { ok: false, reasons: ["media-file"] }
		},
	}
}

function createFilePlugin(): PluginDefinition {
	return {
		detect: async () => ({ ok: true }) as const,
	}
}

function createRegistry(): PluginRegistry {
	return buildRegistry([
		{
			id: PAGES_ID,
			manifest: manifestFor(PAGES_ID, "Pages"),
			enabled: true,
			priority: 50,
			pinned: false,
			color: "",
			missing: false,
			builtin: false,
			dev: false,
			plugin: createPagesPlugin(),
		},
		{
			id: GALLERY_ID,
			manifest: manifestFor(GALLERY_ID, "Gallery"),
			enabled: true,
			priority: 60,
			pinned: false,
			color: "",
			missing: false,
			builtin: false,
			dev: false,
			plugin: createGalleryPlugin(),
		},
		{
			id: FILE_BUILTIN_ID,
			manifest: manifestFor(FILE_BUILTIN_ID, "File"),
			enabled: true,
			priority: Number.MAX_SAFE_INTEGER,
			pinned: false,
			color: "",
			missing: false,
			builtin: true,
			dev: false,
			plugin: createFilePlugin(),
		},
	])
}

function createAPI(files: readonly string[]): ResourceAPI {
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		listFileNames: async () => files,
		readFile: async () => new Uint8Array(),
		statFile: async () => ({ sizeBytes: 0 }),
		statFiles: async (paths) => paths.map(() => ({ sizeBytes: 0 })),
		sniff: async () => undefined,
		probe: async () => ({ kind: "unknown", reason: "unavailable" }),
		hashBytes: async () => "0",
		computeImageHashes: async () => undefined,
		listContainer: async () => ({ entries: [] }),
		extractArchive: async () => ({ entries: [] }),
	}
}

function createHooks(registry: PluginRegistry = createRegistry()) {
	return createPluginHooks({ getRegistry: () => registry })
}

describe("plugin hooks: revalidate", () => {
	test("keeps the explicit plugin when it still matches", async () => {
		const result = await createHooks().revalidate(
			createAPI(["01.png", "02.png"]),
			PAGES_ID,
		)
		expect(result).toBe(PAGES_ID)
	})

	test("falls back from a multi-image plugin to gallery for a single image", async () => {
		const result = await createHooks().revalidate(
			createAPI(["page.png"]),
			PAGES_ID,
		)
		expect(result).toBe(GALLERY_ID)
	})

	test("falls back from gallery to file builtin when there is no media", async () => {
		const result = await createHooks().revalidate(
			createAPI(["notes.txt"]),
			GALLERY_ID,
		)
		expect(result).toBe(FILE_BUILTIN_ID)
	})

	test("falls back to builtin when the explicit plugin is unknown", async () => {
		const result = await createHooks().revalidate(
			createAPI(["page.png"]),
			"00000000-0000-4000-8000-000000000000" as PluginManifestId,
		)
		expect(result).toBe(FILE_BUILTIN_ID)
	})
})

describe("plugin hooks: detectFirstMatch", () => {
	test("returns the first matching plugin in priority order", async () => {
		await expect(
			createHooks().detectFirstMatch(createAPI(["01.png", "02.png"])),
		).resolves.toBe(PAGES_ID)
	})

	test("falls through to the builtin when nothing else matches", async () => {
		await expect(
			createHooks().detectFirstMatch(createAPI(["notes.txt"])),
		).resolves.toBe(FILE_BUILTIN_ID)
	})
})

describe("plugin hooks: detectForImportDir", () => {
	test("matches a non-builtin detector", async () => {
		await expect(
			createHooks().detectForImportDir(createAPI(["01.png", "02.png"])),
		).resolves.toBe(PAGES_ID)
	})

	test("falls back to builtin without invoking its detector", async () => {
		await expect(
			createHooks().detectForImportDir(createAPI(["notes.txt"])),
		).resolves.toBe(FILE_BUILTIN_ID)
	})

	test("a crashing detector is skipped instead of aborting the scan", async () => {
		const crashId = "44444444-4444-4444-8444-444444444444" as PluginManifestId
		const registry = buildRegistry([
			{
				id: crashId,
				manifest: manifestFor(crashId, "Crash"),
				enabled: true,
				priority: 10,
				pinned: false,
				color: "",
				missing: false,
				builtin: false,
				dev: false,
				plugin: {
					detect: async () => {
						throw new Error("detector exploded")
					},
				},
			},
			...createRegistry().getAll(),
		])
		await expect(
			createHooks(registry).detectForImportDir(createAPI(["01.png", "02.png"])),
		).resolves.toBe(PAGES_ID)
	})
})

describe("plugin hooks: getEffectiveEntry", () => {
	test("returns the stored plugin when it is healthy", () => {
		expect(createHooks().getEffectiveEntry(PAGES_ID).id).toBe(PAGES_ID)
	})

	test("falls back to the builtin for a missing plugin", () => {
		const registry = buildRegistry([
			{
				id: PAGES_ID,
				manifest: manifestFor(PAGES_ID, "Pages"),
				enabled: true,
				priority: 50,
				pinned: false,
				color: "",
				missing: true,
				builtin: false,
				dev: false,
				plugin: {
					detect: async () => ({ ok: false, reasons: ["missing"] }),
				},
			},
			...createRegistry().getAll(),
		])
		expect(createHooks(registry).getEffectiveEntry(PAGES_ID).id).toBe(
			FILE_BUILTIN_ID,
		)
	})

	test("falls back to the builtin for a disabled plugin", () => {
		const registry = buildRegistry([
			{
				...createRegistry()
					.getAll()
					.find((e) => e.id === PAGES_ID)!,
				enabled: false,
			},
			...createRegistry()
				.getAll()
				.filter((e) => e.id !== PAGES_ID),
		])
		expect(createHooks(registry).getEffectiveEntry(PAGES_ID).id).toBe(
			FILE_BUILTIN_ID,
		)
	})

	test("falls back to the builtin for an unknown plugin id", () => {
		expect(
			createHooks().getEffectiveEntry(
				"00000000-0000-4000-8000-000000000000" as PluginManifestId,
			).id,
		).toBe(FILE_BUILTIN_ID)
	})

	test("returns the builtin for a null plugin id", () => {
		expect(createHooks().getEffectiveEntry(null).id).toBe(FILE_BUILTIN_ID)
	})

	test("throws when no builtin is registered", () => {
		const registry = buildRegistry(
			createRegistry()
				.getAll()
				.filter((e) => !e.builtin),
		)
		expect(() => createHooks(registry).getEffectiveEntry(null)).toThrow(
			/No builtin plugin/,
		)
	})
})

describe("plugin hooks: runMetaHooks", () => {
	function createMetaRegistry(opts: {
		sourceMeta: boolean
		searchMeta: boolean
	}): PluginRegistry {
		const id = "55555555-5555-4555-8555-555555555555" as PluginManifestId
		return buildRegistry([
			{
				id,
				manifest: manifestFor(id, "Meta", opts),
				enabled: true,
				priority: 10,
				pinned: false,
				color: "",
				missing: false,
				builtin: false,
				dev: false,
				plugin: {
					detect: async () => ({ ok: true }),
					sourceMeta: async () => ({ coverKind: "image" }),
					searchMeta: async () => undefined,
				},
			},
		])
	}

	test("runs permitted hooks and reports raw results", async () => {
		const id = "55555555-5555-4555-8555-555555555555" as PluginManifestId
		const hooks = createHooks(
			createMetaRegistry({ sourceMeta: true, searchMeta: true }),
		)
		const results = await hooks.runMetaHooks(createAPI([]), id)
		expect(results.sourceMeta?.value).toEqual({ coverKind: "image" })
		// Hook ran but returned undefined — callers distinguish this from
		// "did not run" via key presence.
		expect(results.searchMeta).toBeDefined()
		expect(results.searchMeta?.value).toBeUndefined()
	})

	test("skips hooks the manifest does not permit", async () => {
		const id = "55555555-5555-4555-8555-555555555555" as PluginManifestId
		const hooks = createHooks(
			createMetaRegistry({ sourceMeta: false, searchMeta: false }),
		)
		const results = await hooks.runMetaHooks(createAPI([]), id)
		expect(results.sourceMeta).toBeUndefined()
		expect(results.searchMeta).toBeUndefined()
	})

	test("returns empty results for an unknown plugin", async () => {
		const results = await createHooks().runMetaHooks(
			createAPI([]),
			"99999999-9999-4999-8999-999999999999" as PluginManifestId,
		)
		expect(results).toEqual({})
	})

	test("a failing meta hook is logged and skipped without blocking the other", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const id = "55555555-5555-4555-8555-555555555555" as PluginManifestId
		const registry = buildRegistry([
			{
				id,
				manifest: manifestFor(id, "Meta", {
					sourceMeta: true,
					searchMeta: true,
				}),
				enabled: true,
				priority: 10,
				pinned: false,
				color: "",
				missing: false,
				builtin: false,
				dev: false,
				plugin: {
					detect: async () => ({ ok: true }),
					sourceMeta: async () => {
						throw new Error("sourceMeta exploded")
					},
					searchMeta: async () => ({ tags: ["a"] }),
				},
			},
		])
		try {
			const results = await createHooks(registry).runMetaHooks(
				createAPI([]),
				id,
			)
			expect(results.sourceMeta).toBeUndefined()
			expect(results.searchMeta?.value).toEqual({ tags: ["a"] })
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(`sourceMeta failed for plugin ${id}`),
			)
		} finally {
			errorSpy.mockRestore()
		}
	})
})

describe("plugin hooks: buildFileList validation", () => {
	test("rejects non-scalar values in file list items", async () => {
		const id = "66666666-6666-4666-8666-666666666666" as PluginManifestId
		const registry = buildRegistry([
			{
				id,
				manifest: manifestFor(id, "Bad"),
				enabled: true,
				priority: 10,
				pinned: false,
				color: "",
				missing: false,
				builtin: false,
				dev: false,
				plugin: {
					detect: async () => ({ ok: true }),
					listFiles: async () => [{ filename: "a.png", nested: { bad: 1 } }],
				},
			},
		])
		await expect(
			createHooks(registry).buildFileList(createAPI([]), id),
		).rejects.toThrow(/invalid file list item value type/)
	})
})

describe("plugin hooks: imageHashes", () => {
	const HASHER_ID = "44444444-4444-4444-8444-444444444444" as PluginManifestId

	function registryWithImageHashes(
		imageHashes?: PluginDefinition["imageHashes"],
		granted = true,
	): PluginRegistry {
		return buildRegistry([
			{
				id: HASHER_ID,
				manifest: manifestFor(HASHER_ID, "Hasher", { imageHashes: granted }),
				enabled: true,
				priority: 10,
				pinned: false,
				color: "",
				missing: false,
				builtin: false,
				dev: false,
				plugin: {
					detect: async () => ({ ok: true }),
					...(imageHashes !== undefined ? { imageHashes } : {}),
				},
			},
		])
	}

	test("resolves undefined when the permission is not granted", async () => {
		const hooks = createHooks(
			registryWithImageHashes(async () => ({ hashes: [] }), false),
		)
		expect(hooks.supportsImageHashes(HASHER_ID)).toBe(false)
		await expect(
			hooks.runImageHashes(createAPI([]), HASHER_ID),
		).resolves.toBeUndefined()
	})

	test("resolves undefined when the plugin implements no hook", async () => {
		const hooks = createHooks(registryWithImageHashes(undefined))
		expect(hooks.supportsImageHashes(HASHER_ID)).toBe(false)
		await expect(
			hooks.runImageHashes(createAPI([]), HASHER_ID),
		).resolves.toBeUndefined()
	})

	test("passes valid entries through with defaulted bits", async () => {
		const hooks = createHooks(
			registryWithImageHashes(async () => ({
				hashes: [{ scope: "1.jpg", type: "sha256", value: "ab" }],
			})),
		)
		expect(hooks.supportsImageHashes(HASHER_ID)).toBe(true)
		await expect(
			hooks.runImageHashes(createAPI([]), HASHER_ID),
		).resolves.toEqual({
			hashes: [{ scope: "1.jpg", type: "sha256", value: "ab", bits: 8 }],
		})
	})

	test("drops malformed entries and keeps the valid ones", async () => {
		// Deliberately out-of-contract input — the sanitizer is the guard.
		const malformed = (async () => ({
			hashes: [
				{ scope: "", type: "sha256", value: "ab" },
				{ scope: "2.jpg", type: "sha256", value: "AB" },
				{ scope: "3.jpg", type: "dhash", value: "cafe", bits: 64 },
				{ scope: "4.jpg", type: "sha256", value: "de" },
				null,
				"junk",
			],
		})) as PluginDefinition["imageHashes"]
		const hooks = createHooks(registryWithImageHashes(malformed))
		await expect(
			hooks.runImageHashes(createAPI([]), HASHER_ID),
		).resolves.toEqual({
			hashes: [
				{ scope: "3.jpg", type: "dhash", value: "cafe", bits: 64 },
				{ scope: "4.jpg", type: "sha256", value: "de", bits: 8 },
			],
		})
	})

	test("caps the entry count and preserves hook errors as undefined", async () => {
		const huge = async () => ({
			hashes: Array.from({ length: 2500 }, (_, i) => ({
				scope: `${i}.jpg`,
				type: "sha256",
				value: "ab",
			})),
		})
		const capped = await createHooks(
			registryWithImageHashes(huge),
		).runImageHashes(createAPI([]), HASHER_ID)
		expect(capped?.hashes.length).toBe(2000)

		const throwing = createHooks(
			registryWithImageHashes(async () => {
				throw new Error("boom")
			}),
		)
		await expect(
			throwing.runImageHashes(createAPI([]), HASHER_ID),
		).resolves.toBeUndefined()
	})
})
