import type { PluginRegistry, PluginRegistryEntry } from "@hoardodile/host"
import {
	buildRegistry,
	createPluginHooks,
	type PluginHooks,
} from "@hoardodile/host"
import type { PluginDefinition, ResourceAPI } from "@hoardodile/sdk-server"
import { probeMediaFile } from "@hoardodile/sdk-server/helpers"

export const TEST_BUILTIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"
export const TEST_BUILTIN_MANIFEST = {
	id: TEST_BUILTIN_ID,
	name: "Gallery",
	description: "Test builtin",
	version: "1.0.0",
	permissions: {
		sourceMeta: true,
		searchMeta: true,
		danmaku: true,
		message: true,
		imageHashes: true,
		preferences: false,
		node: false,
		container: false,
		download: false,
	},
}

function createStubGalleryPlugin(): PluginDefinition {
	return {
		detect: async () => ({ ok: true }),
		sourceMeta: buildSourceMetaGalleryStub,
		coverLocal: buildLocalCoverStub,
		listFiles: buildFileListStub,
		imageHashes: async (api) => {
			const files = await api.listFileNames()
			const types = await Promise.all(files.map((name) => api.sniff(name)))
			const hashes = files
				.filter((_, index) => types[index]?.kind === "image")
				.map((scope) => ({
					scope,
					type: "sha256",
					value: "ab",
					bits: 8,
				}))
			return { hashes }
		},
	}
}

async function buildLocalCoverStub(
	api: ResourceAPI,
): Promise<string | undefined> {
	const files = await api.listFileNames()
	const audioFiles: string[] = []
	for (const filename of files) {
		const kind = (await api.sniff(filename))?.kind
		if (kind === "image" || kind === "video") return filename
		if (kind === "audio") audioFiles.push(filename)
	}
	if (audioFiles.length === 0) return undefined
	for (const filename of audioFiles) {
		const probed = await api.probe(filename)
		if (probed.kind === "audio" && probed.coverArt !== undefined) {
			return filename
		}
	}
	return audioFiles[0]
}

async function buildFileListStub(api: ResourceAPI) {
	const files = await api.listFileNames()
	const result: {
		readonly filename: string
		readonly type?: "image" | "video" | "audio"
		readonly width?: number
		readonly height?: number
		readonly preview?: boolean
		readonly durationMs?: number
	}[] = []
	for (const filename of files) {
		const probed = await probeMediaFile(api, filename)
		if (probed !== undefined) result.push({ filename, ...probed })
	}
	return result
}

let metaBuildCalls = 0
let metaBuildInFlight = 0
let metaBuildPeak = 0
let metaBuildDelayMs = 0

export function resetMetaBuildTracking(): void {
	metaBuildCalls = 0
	metaBuildInFlight = 0
	metaBuildPeak = 0
	metaBuildDelayMs = 0
}

export function getMetaBuildCalls(): number {
	return metaBuildCalls
}

export function getMetaBuildPeak(): number {
	return metaBuildPeak
}

export function setMetaBuildDelay(ms: number): void {
	metaBuildDelayMs = ms
}

export async function trackMetaBuild<T>(fn: () => Promise<T>): Promise<T> {
	metaBuildCalls += 1
	metaBuildInFlight += 1
	metaBuildPeak = Math.max(metaBuildPeak, metaBuildInFlight)
	if (metaBuildDelayMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, metaBuildDelayMs))
	}
	try {
		return await fn()
	} finally {
		metaBuildInFlight -= 1
	}
}

async function buildSourceMetaGalleryStub(
	_resAPI: ResourceAPI,
): Promise<unknown | undefined> {
	metaBuildCalls += 1
	metaBuildInFlight += 1
	metaBuildPeak = Math.max(metaBuildPeak, metaBuildInFlight)
	if (metaBuildDelayMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, metaBuildDelayMs))
	}
	metaBuildInFlight -= 1
	return { coverKind: "image" as const, width: 1, height: 1 }
}

/**
 * Minimal PluginRegistry for tests that only need a builtin gallery plugin
 * (no detection / content-type logic).
 */
export function createTestRegistry(): PluginRegistry {
	const entry: PluginRegistryEntry = {
		id: TEST_BUILTIN_ID,
		manifest: TEST_BUILTIN_MANIFEST,
		enabled: true,
		priority: Number.MAX_SAFE_INTEGER,
		pinned: false,
		color: "",
		missing: false,
		builtin: true,
		dev: false,
		plugin: createStubGalleryPlugin(),
	}
	return buildRegistry([entry])
}

/** PluginHooks facade backed by the builtin test registry. */
export function createTestHooks(
	registry: PluginRegistry = createTestRegistry(),
): PluginHooks {
	return createPluginHooks({ getRegistry: () => registry })
}
