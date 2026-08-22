import { mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const { probeImageSource, probeVideo, probeAudio } = vi.hoisted(() => ({
	probeImageSource: vi.fn(),
	probeVideo: vi.fn(),
	probeAudio: vi.fn(),
}))

vi.mock("@hoardodile/host/probe", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@hoardodile/host/probe")>()
	return {
		// readImageMetadata stays real: it is exercised on an actual file
		// in the rebuildResourceFully tests.
		...actual,
		probeImageSource,
		probeVideo,
		probeAudio,
		probeImage: vi.fn(),
		probeAnimatedImage: vi.fn(),
	}
})

import { HASHES_META_VERSION } from "@hoardodile/schemas"
import type { ResourceAPI } from "@hoardodile/sdk-server"
import { fileTypeFromName } from "@hoardodile/sdk-server"
import { buildResMetaOps } from "./meta-ops.ts"
import type { ResRow } from "./repo.ts"
import type { SourceArtifactView } from "./source-view.ts"
import {
	createTestHooks,
	createTestRegistry,
	TEST_BUILTIN_ID,
} from "./test-registry.ts"

function mockZipView(
	overrides: Partial<SourceArtifactView> = {},
): SourceArtifactView {
	const stream = Readable.from(Buffer.from("fake-video"))
	return {
		resId: "res-1",
		fileVersion: 1,
		kind: "dir",
		dirPath: "/fake/resource-dir",
		listEntries: async () => ["clip.mp4"],
		readEntry: async () => Buffer.alloc(0),
		readEntrySlice: async () => Buffer.alloc(0),
		openEntryStream: async () => ({ stream, size: 100 }),
		withMaterializedEntry: async (_rel, fn) => fn("/tmp/clip.mp4"),
		withSeekableEntry: async (_rel, fn) => fn("/tmp/clip.mp4"),
		resolveByteRange: async () => ({
			size: 100,
		}),
		...overrides,
	}
}

function makeRow(overrides: Partial<ResRow> = {}): ResRow {
	return {
		id: "res-1",
		name: "test",
		intro: "",
		contentPluginId: TEST_BUILTIN_ID,
		fileVersion: 1,
		coverVersion: 0,
		fileStats: null,
		sourceMeta: null,
		searchMeta: null,
		coverMeta: null,
		createdAt: 0,
		updatedAt: 0,
		tagIds: [],
		charIds: [],
		...overrides,
	} as ResRow
}

describe("buildResMetaOps cover meta", () => {
	const registry = createTestRegistry()
	let row: ResRow
	const patches: Record<string, string | null>[] = []

	beforeEach(() => {
		row = makeRow()
		patches.length = 0
		probeImageSource.mockReset()
		probeVideo.mockReset()
		probeAudio.mockReset()
		probeAudio.mockResolvedValue(undefined)
		probeImageSource.mockResolvedValue({
			width: 100,
			height: 100,
			animated: false,
		})
		probeVideo.mockResolvedValue({
			width: 1920,
			height: 1080,
			durationMs: 12_000,
		})
	})

	function buildOps(
		view: SourceArtifactView,
		opts: {
			readonly files?: readonly string[]
			readonly probeAudio?: ResourceAPI["probe"]
		} = {},
	) {
		const files = opts.files ?? ["clip.mp4"]
		const repo = {
			findById: () => row,
			patchMeta: (_id: string, patch: Record<string, string | null>) => {
				patches.push(patch)
				row = { ...row, ...patch } as ResRow
			},
			replaceHashes: () => {},
		}
		const api: ResourceAPI = {
			logInfo() {},
			logWarn() {},
			logError() {},
			context: { detect: undefined },
			async listFileNames() {
				return files
			},
			async readFile() {
				return new Uint8Array()
			},
			async statFile() {
				return { sizeBytes: 1 }
			},
			async statFiles() {
				return [{ sizeBytes: 1 }]
			},
			async sniff(path) {
				return fileTypeFromName(path)
			},
			async probe() {
				return { kind: "unknown", reason: "unavailable" } as const
			},
			async hashBytes() {
				return "0"
			},
			async computeImageHashes() {
				return undefined
			},
			async extractArchive() {
				return { entries: [] }
			},
			async listContainer() {
				return { entries: [] }
			},
		}
		return buildResMetaOps({
			repo: repo as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => api,
			resolveSourceView: async () => view,
			findCover: async () => undefined,
		})
	}

	test("mp4 local cover probes the materialized entry, not a pipe", async () => {
		const view = mockZipView()
		const ops = buildOps(view)
		await ops.rebuildCoverMeta("res-1")

		// ISO-BMFF cannot be probed from a forward-only pipe — ffprobe
		// burns a full probesize read then fails. The materialized entry
		// is probed by path instead.
		expect(probeVideo).toHaveBeenCalledTimes(1)
		expect(typeof probeVideo.mock.calls[0]?.[0]).toBe("string")
		expect(probeImageSource).not.toHaveBeenCalled()
		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			height?: number
			source?: string
		}
		expect(coverMeta).toMatchObject({
			kind: "video",
			source: "clip.mp4",
		})
		expect(coverMeta.width).toBeTypeOf("number")
		expect(coverMeta.height).toBeTypeOf("number")
	})

	test("streamable video cover (webm) still probes the entry stream", async () => {
		const view = mockZipView({
			listEntries: async () => ["clip.webm"],
		})
		const api: ResourceAPI = {
			logInfo() {},
			logWarn() {},
			logError() {},
			context: { detect: undefined },
			async listFileNames() {
				return ["clip.webm"]
			},
			async readFile() {
				return new Uint8Array()
			},
			async statFile() {
				return { sizeBytes: 1 }
			},
			async statFiles() {
				return [{ sizeBytes: 1 }]
			},
			async sniff(path) {
				return fileTypeFromName(path)
			},
			async probe() {
				return { kind: "unknown", reason: "unavailable" } as const
			},
			async hashBytes() {
				return "0"
			},
			async computeImageHashes() {
				return undefined
			},
			async extractArchive() {
				return { entries: [] }
			},
			async listContainer() {
				return { entries: [] }
			},
		}
		const ops = buildResMetaOps({
			repo: {
				findById: () => row,
				patchMeta: (_id: string, patch: Record<string, string | null>) => {
					patches.push(patch)
					row = { ...row, ...patch } as ResRow
				},
				replaceHashes: () => {},
			} as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => api,
			resolveSourceView: async () => view,
			findCover: async () => undefined,
		})
		await ops.rebuildCoverMeta("res-1")

		expect(probeVideo).toHaveBeenCalledTimes(1)
		expect(typeof probeVideo.mock.calls[0]?.[0]?.pipe).toBe("function")
	})

	test("image local cover probes through a reopenable stream, not a raw stream", async () => {
		const view = mockZipView({
			listEntries: async () => ["page.png"],
		})
		const api: ResourceAPI = {
			logInfo() {},
			logWarn() {},
			logError() {},
			context: { detect: undefined },
			async listFileNames() {
				return ["page.png"]
			},
			async readFile() {
				return new Uint8Array()
			},
			async statFile() {
				return { sizeBytes: 1 }
			},
			async statFiles() {
				return [{ sizeBytes: 1 }]
			},
			async sniff(path) {
				return fileTypeFromName(path)
			},
			async probe() {
				return { kind: "unknown", reason: "unavailable" } as const
			},
			async hashBytes() {
				return "0"
			},
			async computeImageHashes() {
				return undefined
			},
			async extractArchive() {
				return { entries: [] }
			},
			async listContainer() {
				return { entries: [] }
			},
		}
		const ops = buildResMetaOps({
			repo: {
				findById: () => row,
				patchMeta: (_id: string, patch: Record<string, string | null>) => {
					patches.push(patch)
					row = { ...row, ...patch } as ResRow
				},
				replaceHashes: () => {},
			} as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => api,
			resolveSourceView: async () => view,
			findCover: async () => undefined,
		})
		await ops.rebuildCoverMeta("res-1")

		// The cover probe must hand readImageMetadata a reopenable source so
		// it reads only the header — a raw stream would be buffered whole
		// (and fail for entries beyond the buffer cap).
		expect(probeImageSource).toHaveBeenCalledTimes(1)
		const input = probeImageSource.mock.calls[0]?.[0] as
			| { openStream: () => Promise<unknown> }
			| undefined
		expect(typeof input?.openStream).toBe("function")
		expect(probeVideo).not.toHaveBeenCalled()
		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			height?: number
			source?: string
		}
		expect(coverMeta).toMatchObject({
			kind: "image",
			source: "page.png",
			width: 100,
			height: 100,
		})
	})

	test("audio local cover keeps kind audio and records the artwork dims", async () => {
		probeAudio.mockResolvedValue({
			durationMs: 180_000,
			coverArt: { width: 300, height: 300 },
		})
		const view = mockZipView({ listEntries: async () => ["track.flac"] })
		const ops = buildOps(view, {
			files: ["track.flac"],
			probeAudio: async () => ({
				kind: "audio",
				mime: "audio/flac",
				coverArt: { width: 300, height: 300 },
			}),
		})
		await ops.rebuildCoverMeta("res-1")

		// flac leads with its header, so the artwork probe reads the entry
		// stream rather than materializing the whole track.
		expect(typeof probeAudio.mock.calls.at(-1)?.[0]?.pipe).toBe("function")
		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			height?: number
			source?: string
		}
		expect(coverMeta).toMatchObject({
			kind: "audio",
			source: "track.flac",
			width: 300,
			height: 300,
		})
	})

	test("audio without artwork stays dimensionless so the card owns the tile", async () => {
		probeAudio.mockResolvedValue({ durationMs: 180_000 })
		const view = mockZipView({ listEntries: async () => ["track.flac"] })
		const ops = buildOps(view, { files: ["track.flac"] })
		await ops.rebuildCoverMeta("res-1")

		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			height?: number
		}
		expect(coverMeta).toMatchObject({ kind: "audio" })
		expect(coverMeta.width).toBeUndefined()
		expect(coverMeta.height).toBeUndefined()
	})

	test("m4a artwork probes the materialized entry, not a pipe", async () => {
		probeAudio.mockResolvedValue({ coverArt: { width: 300, height: 300 } })
		const view = mockZipView({ listEntries: async () => ["track.m4a"] })
		const ops = buildOps(view, { files: ["track.m4a"] })
		await ops.rebuildCoverMeta("res-1")

		// ISO-BMFF keeps its index at the end of the file, so a pipe probe
		// would burn a full probesize read and then fail.
		expect(typeof probeAudio.mock.calls.at(-1)?.[0]).toBe("string")
	})

	test("rebuildCoverMeta does not bump updatedAt", async () => {
		const view = mockZipView()
		row = makeRow({ updatedAt: 42 })
		const ops = buildOps(view)
		await ops.rebuildCoverMeta("res-1")

		expect(row.updatedAt).toBe(42)
		expect(patches.at(-1)).not.toHaveProperty("updatedAt")
	})

	test("permanent image cover keeps video kind from buildLocalCover", async () => {
		const view = mockZipView()
		const repo = {
			findById: () => row,
			patchMeta: (_id: string, patch: Record<string, string | null>) => {
				patches.push(patch)
				row = { ...row, ...patch } as ResRow
			},
			replaceHashes: () => {},
		}
		const api: ResourceAPI = {
			logInfo() {},
			logWarn() {},
			logError() {},
			context: { detect: undefined },
			async listFileNames() {
				return ["clip.mp4"]
			},
			async readFile() {
				return new Uint8Array()
			},
			async statFile() {
				return { sizeBytes: 1 }
			},
			async statFiles() {
				return [{ sizeBytes: 1 }]
			},
			async sniff(path) {
				return fileTypeFromName(path)
			},
			async probe() {
				return { kind: "unknown", reason: "unavailable" } as const
			},
			async hashBytes() {
				return "0"
			},
			async computeImageHashes() {
				return undefined
			},
			async extractArchive() {
				return { entries: [] }
			},
			async listContainer() {
				return { entries: [] }
			},
		}
		const ops = buildResMetaOps({
			repo: repo as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => api,
			resolveSourceView: async () => view,
			findCover: async () => "/fake/.cover.jpg",
		})
		await ops.rebuildCoverMeta("res-1")

		expect(probeImageSource).toHaveBeenCalledWith("/fake/.cover.jpg", ".jpg")
		expect(probeVideo).toHaveBeenCalledTimes(1)
		expect(typeof probeVideo.mock.calls[0]?.[0]).toBe("string")
		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			height?: number
			source?: string
		}
		expect(coverMeta).toMatchObject({
			kind: "video",
			source: "clip.mp4",
			width: 100,
			height: 100,
		})
	})
})

describe("buildResMetaOps global rebuild concurrency", () => {
	test("enqueued rebuilds across resources stay within the global cap", async () => {
		const registry = createTestRegistry()
		const rows = new Map<string, ResRow>()
		for (let i = 0; i < 10; i++) {
			const id = `res-${i}`
			rows.set(id, makeRow({ id }))
		}

		let inFlight = 0
		let maxInFlight = 0
		async function track<T>(fn: () => Promise<T>): Promise<T> {
			inFlight++
			maxInFlight = Math.max(maxInFlight, inFlight)
			try {
				await new Promise((resolve) => setTimeout(resolve, 5))
				return await fn()
			} finally {
				inFlight--
			}
		}

		const view = mockZipView()
		const api: ResourceAPI = {
			logInfo() {},
			logWarn() {},
			logError() {},
			context: { detect: undefined },
			async listFileNames() {
				return ["clip.mp4"]
			},
			async readFile() {
				return new Uint8Array()
			},
			async statFile() {
				return { sizeBytes: 1 }
			},
			async statFiles() {
				return [{ sizeBytes: 1 }]
			},
			async sniff(path) {
				return fileTypeFromName(path)
			},
			async probe() {
				return { kind: "unknown", reason: "unavailable" } as const
			},
			async hashBytes() {
				return "0"
			},
			async computeImageHashes() {
				return undefined
			},
			async extractArchive() {
				return { entries: [] }
			},
			async listContainer() {
				return { entries: [] }
			},
		}
		const ops = buildResMetaOps({
			repo: {
				findById: (id: string) => {
					const row = rows.get(id)
					if (row === undefined) throw new Error(`missing row ${id}`)
					return row
				},
				patchMeta: () => {},
				replaceHashes: () => {},
			} as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: () => track(async () => api),
			resolveSourceView: () => track(async () => view),
			findCover: async () => undefined,
		})

		// 10 resources × 3 rebuild queues — a cold-start-style burst.
		for (const id of rows.keys()) ops.enqueueFullMetaRebuild(id)
		await ops.drainQueue()

		expect(maxInFlight).toBeGreaterThan(1)
		// The limiter caps concurrent resources at 4; within a resource the
		// API and view builds may overlap, so the heavy-call ceiling is 2×.
		expect(maxInFlight).toBeLessThanOrEqual(8)
	})
})

// ── Unified orchestrator (runMetaRebuild / enqueueMetaRebuild) ─────────

function mockApi(): ResourceAPI {
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		async listFileNames() {
			return ["clip.mp4"]
		},
		async readFile() {
			return new Uint8Array()
		},
		async statFile() {
			return { sizeBytes: 1 }
		},
		async statFiles() {
			return [{ sizeBytes: 1 }]
		},
		async sniff(path) {
			return fileTypeFromName(path)
		},
		async probe() {
			return { kind: "unknown", reason: "unavailable" } as const
		},
		async hashBytes() {
			return "0"
		},
		async computeImageHashes() {
			return undefined
		},
		async listContainer() {
			return { entries: [] }
		},
		async extractArchive() {
			return { entries: [] }
		},
	}
}

describe("runMetaRebuild orchestration", () => {
	const registry = createTestRegistry()
	let row: ResRow
	const patches: Record<string, string | null>[] = []
	let warnSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		row = makeRow()
		patches.length = 0
		probeImageSource.mockReset()
		probeVideo.mockReset()
		probeVideo.mockResolvedValue({
			width: 1920,
			height: 1080,
			durationMs: 12_000,
		})
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		warnSpy.mockRestore()
	})

	function buildOps(opts: {
		readonly view?: SourceArtifactView
		readonly viewError?: Error
		readonly hooks?: ReturnType<typeof createTestHooks>
	}) {
		const repo = {
			findById: () => row,
			patchMeta: (_id: string, patch: Record<string, string | null>) => {
				patches.push(patch)
				row = { ...row, ...patch } as ResRow
			},
			replaceHashes: () => {},
		}
		return buildResMetaOps({
			repo: repo as never,
			now: () => 1,
			pluginHooks: opts.hooks ?? createTestHooks(registry),
			createResourceAPI: async () => mockApi(),
			resolveSourceView: async () => {
				if (opts.viewError !== undefined) throw opts.viewError
				return opts.view ?? mockZipView()
			},
			findCover: async () => undefined,
		})
	}

	test("a failing unit is isolated and the rest land in one merged patch", async () => {
		const ops = buildOps({ viewError: new Error("view boom") })
		await ops.rebuildAllMeta("res-1")

		// fileStats and coverMeta both need the source view and fail;
		// pluginMeta only needs the API and succeeds.
		expect(warnSpy).toHaveBeenCalledTimes(2)
		expect(warnSpy.mock.calls[0]?.[0]).toContain(
			"[meta-ops] fileStats for res-1: view boom",
		)
		expect(warnSpy.mock.calls[1]?.[0]).toContain(
			"[meta-ops] coverMeta for res-1: view boom",
		)
		expect(patches).toHaveLength(1)
		expect(patches[0]).toHaveProperty("sourceMeta")
		expect(patches[0]).not.toHaveProperty("fileStats")
		expect(patches[0]).not.toHaveProperty("coverMeta")
	})

	test("enqueueMetaRebuild routes only the requested units", async () => {
		const ops = buildOps({})
		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()

		expect(patches).toHaveLength(1)
		expect(patches[0]).toHaveProperty("sourceMeta")
		expect(patches[0]).not.toHaveProperty("fileStats")
		expect(patches[0]).not.toHaveProperty("coverMeta")
	})

	test("plugin-less rows clear plugin-produced meta but recompute fileStats", async () => {
		row = makeRow({
			contentPluginId: null,
			fileStats: JSON.stringify({ count: 1 }),
			sourceMeta: JSON.stringify({ stale: true }),
			coverMeta: JSON.stringify({ kind: "image" }),
		})
		probeImageSource.mockResolvedValue({
			width: 100,
			height: 50,
			animated: false,
		})
		const repo = {
			findById: () => row,
			patchMeta: (_id: string, patch: Record<string, string | null>) => {
				patches.push(patch)
				row = { ...row, ...patch } as ResRow
			},
			replaceHashes: () => {},
		}
		const ops = buildResMetaOps({
			repo: repo as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => mockApi(),
			resolveSourceView: async () => mockZipView(),
			findCover: async () => "/fake/.cover.jpg",
		})
		await ops.rebuildAllMeta("res-1")

		expect(patches).toHaveLength(1)
		// fileStats is plugin-independent: recomputed from the source view,
		// not cleared.
		const fileStats = JSON.parse(patches[0]?.fileStats ?? "{}") as {
			count?: number
			sizeBytes?: number
		}
		expect(fileStats).toEqual({ count: 1, sizeBytes: 100 })
		expect(patches[0]?.sourceMeta).toBeNull()
		// Shared cover keeps producing dims even without a plugin.
		const coverMeta = JSON.parse(patches[0]?.coverMeta ?? "{}") as {
			kind: string
			width?: number
		}
		expect(coverMeta.kind).toBe("image")
		expect(coverMeta.width).toBeTypeOf("number")
	})

	test("plugin-less rows with no cover write the empty sentinel", async () => {
		row = makeRow({
			contentPluginId: null,
			coverMeta: null,
		})
		const ops = buildResMetaOps({
			repo: {
				findById: () => row,
				patchMeta: (_id: string, patch: Record<string, string | null>) => {
					patches.push(patch)
					row = { ...row, ...patch } as ResRow
				},
				replaceHashes: () => {},
			} as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => mockApi(),
			resolveSourceView: async () => mockZipView(),
			findCover: async () => undefined,
		})
		await ops.rebuildCoverMeta("res-1")
		expect(JSON.parse(patches.at(-1)?.coverMeta ?? "{}")).toEqual({
			empty: true,
		})
	})

	test("plugin-less rows keep fileStats when the source view fails", async () => {
		row = makeRow({
			contentPluginId: null,
			fileStats: JSON.stringify({ count: 3, sizeBytes: 30 }),
		})
		const ops = buildOps({ viewError: new Error("view boom") })
		await ops.rebuildMeta("res-1", ["fileStats"])

		expect(warnSpy.mock.calls[0]?.[0]).toContain(
			"[meta-ops] fileStats for res-1: view boom",
		)
		// Nothing to patch — the existing value is preserved untouched.
		expect(patches).toHaveLength(0)
		expect(row.fileStats).toBe(JSON.stringify({ count: 3, sizeBytes: 30 }))
	})
})

describe("failed rebuild cooldown", () => {
	const registry = createTestRegistry()
	let row: ResRow
	const patches: Record<string, string | null>[] = []

	beforeEach(() => {
		row = makeRow()
		patches.length = 0
	})

	function buildOps(opts: {
		readonly now: () => number
		readonly createResourceAPI: () => Promise<ResourceAPI>
	}) {
		return buildResMetaOps({
			repo: {
				findById: () => row,
				patchMeta: (_id: string, patch: Record<string, string | null>) => {
					patches.push(patch)
					row = { ...row, ...patch } as ResRow
				},
				replaceHashes: () => {},
			} as never,
			now: opts.now,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: opts.createResourceAPI,
			resolveSourceView: async () => mockZipView(),
			findCover: async () => undefined,
		})
	}

	test("failed enqueued rebuilds are suppressed within the cooldown window", async () => {
		let now = 1_000_000
		let apiBuilds = 0
		const ops = buildOps({
			now: () => now,
			createResourceAPI: async () => {
				apiBuilds++
				throw new Error("worker stopped")
			},
		})

		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()
		// First run failed: sourceMeta is still missing.
		expect(apiBuilds).toBe(1)
		expect(row.sourceMeta).toBeNull()

		// An immediate re-enqueue (a list-page retry storm) is suppressed.
		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()
		expect(apiBuilds).toBe(1)

		// Past the window the unit retries.
		now += 31_000
		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()
		expect(apiBuilds).toBe(2)
	})

	test("a successful retry clears the cooldown mark", async () => {
		let now = 1_000_000
		let failing = true
		let apiBuilds = 0
		const ops = buildOps({
			now: () => now,
			createResourceAPI: async () => {
				apiBuilds++
				if (failing) throw new Error("worker stopped")
				return mockApi()
			},
		})

		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()
		expect(apiBuilds).toBe(1)

		// The worker recovers; after the window the retry succeeds.
		now += 31_000
		failing = false
		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()
		expect(apiBuilds).toBe(2)
		expect(patches).toHaveLength(1)
		expect(patches[0]).toHaveProperty("sourceMeta")

		// Success cleared the mark — an immediate re-enqueue runs again
		// (and finds nothing to change).
		ops.enqueueMetaRebuild("res-1", ["pluginMeta"])
		await ops.drainQueue()
		expect(apiBuilds).toBe(3)
	})
})

describe("rebuildResourceFully", () => {
	const registry = createTestRegistry()
	let row: ResRow
	let tmpRoot: string
	const patches: Record<string, string | null>[] = []

	beforeEach(() => {
		row = makeRow()
		patches.length = 0
		probeImageSource.mockReset()
		probeVideo.mockReset()
		probeVideo.mockResolvedValue({
			width: 1920,
			height: 1080,
			durationMs: 12_000,
		})
		tmpRoot = mkdtempSync(join(tmpdir(), "meta-ops-fully-"))
	})

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true })
	})

	function buildOps(hooks: ReturnType<typeof createTestHooks>) {
		const repo = {
			findById: () => row,
			patchMeta: (_id: string, patch: Record<string, string | null>) => {
				patches.push(patch)
				row = { ...row, ...patch } as ResRow
			},
			replaceHashes: () => {},
		}
		return buildResMetaOps({
			repo: repo as never,
			now: () => 1,
			pluginHooks: hooks,
			createResourceAPI: async () => mockApi(),
			resolveSourceView: async () => mockZipView(),
			findCover: async () => undefined,
		})
	}

	test("records coverMeta from the rendered thumb with a single cover-source RPC", async () => {
		const hooks = createTestHooks(registry)
		const coverSourceSpy = vi.spyOn(hooks, "resolveLocalCoverSource")
		const thumbPath = join(tmpRoot, "cover.avif")
		await writeFile(
			thumbPath,
			await sharp({
				create: {
					width: 40,
					height: 30,
					channels: 3,
					background: { r: 1, g: 2, b: 3 },
				},
			})
				.png()
				.toBuffer(),
		)
		const ops = buildOps(hooks)

		const result = await ops.rebuildResourceFully("res-1", async () => ({
			kind: "ready" as const,
			path: thumbPath,
		}))

		expect(result.coverReady).toBe(true)
		expect(result.updatedAt).toBe(row.updatedAt)
		// fileStats+pluginMeta ran in the same pass (merged patch), then the
		// coverMeta write came from the rendered thumb — the cover-source
		// RPC happened exactly once for the whole pipeline.
		expect(patches[0]).toHaveProperty("fileStats")
		expect(patches[0]).toHaveProperty("sourceMeta")
		expect(coverSourceSpy).toHaveBeenCalledTimes(1)
		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			height?: number
			source?: string
		}
		expect(coverMeta).toMatchObject({
			width: 40,
			height: 30,
			kind: "video",
			source: "clip.mp4",
		})
	})

	test("falls back to the probe-based cover rebuild when no thumb renders", async () => {
		const ops = buildOps(createTestHooks(registry))

		const result = await ops.rebuildResourceFully("res-1", async () => ({
			kind: "unavailable" as const,
		}))

		expect(result.coverReady).toBe(false)
		const coverMeta = JSON.parse(patches.at(-1)?.coverMeta ?? "{}") as {
			kind: string
			width?: number
			source?: string
		}
		expect(coverMeta).toMatchObject({ kind: "video", source: "clip.mp4" })
		expect(coverMeta.width).toBeTypeOf("number")
		expect(probeVideo).toHaveBeenCalledTimes(1)
	})
})

describe("hashes unit", () => {
	const registry = createTestRegistry()
	let row: ResRow
	const patches: Record<string, string | null>[] = []
	let replaced: { resourceId: string; pluginId: string; entries: unknown[] }[]

	beforeEach(() => {
		row = makeRow()
		patches.length = 0
		replaced = []
	})

	function apiWithFiles(files: readonly string[]): ResourceAPI {
		return {
			logInfo() {},
			logWarn() {},
			logError() {},
			context: { detect: undefined },
			listFileNames: async () => [...files],
			readFile: async () => new Uint8Array(),
			statFile: async () => ({ sizeBytes: 1 }),
			statFiles: async (paths) => paths.map(() => ({ sizeBytes: 1 })),
			sniff: async (path) => fileTypeFromName(path),
			probe: async () => ({ kind: "unknown", reason: "unavailable" }),
			hashBytes: async () => "ab",
			computeImageHashes: async () => undefined,
			listContainer: async () => ({ entries: [] }),
			extractArchive: async () => ({ entries: [] }),
		}
	}

	function buildOps(api: ResourceAPI = mockApi()) {
		return buildResMetaOps({
			repo: {
				findById: () => row,
				patchMeta: (_id: string, patch: Record<string, string | null>) => {
					patches.push(patch)
					row = { ...row, ...patch } as ResRow
				},
				replaceHashes: (
					resourceId: string,
					pluginId: string,
					entries: readonly unknown[],
				) => {
					replaced.push({ resourceId, pluginId, entries: [...entries] })
				},
			} as never,
			now: () => 1,
			pluginHooks: createTestHooks(registry),
			createResourceAPI: async () => api,
			resolveSourceView: async () => mockZipView(),
			findCover: async () => undefined,
		})
	}

	test("writes hook hashes and sets the marker", async () => {
		const ops = buildOps(apiWithFiles(["1.jpg"]))
		await ops.rebuildMeta("res-1", ["hashes"])

		expect(replaced).toHaveLength(1)
		expect(replaced[0]?.resourceId).toBe("res-1")
		expect(replaced[0]?.pluginId).toBe(TEST_BUILTIN_ID)
		expect(replaced[0]?.entries).toEqual([
			{ scope: "1.jpg", type: "sha256", value: "ab", bits: 8 },
		])
		expect(patches).toEqual([
			{
				hashesMeta: JSON.stringify({
					v: HASHES_META_VERSION,
					pluginVersion: "1.0.0",
				}),
			},
		])
	})

	test("an empty hook result still marks the resource computed", async () => {
		row = makeRow({ hashesMeta: null })
		const ops = buildOps()
		await ops.rebuildMeta("res-1", ["hashes"])

		expect(replaced[0]?.entries).toEqual([])
		expect(patches).toEqual([
			{
				hashesMeta: JSON.stringify({
					v: HASHES_META_VERSION,
					pluginVersion: "1.0.0",
				}),
			},
		])
	})

	test("plugin-less rows clear rows and marker", async () => {
		row = makeRow({
			contentPluginId: null,
			hashesMeta: JSON.stringify({
				v: HASHES_META_VERSION,
				pluginVersion: "1.0.0",
			}),
		})
		const ops = buildOps()
		await ops.rebuildMeta("res-1", ["hashes"])

		expect(replaced).toEqual([
			{ resourceId: "res-1", pluginId: "", entries: [] },
		])
		expect(patches).toEqual([{ hashesMeta: null }])
	})

	test("an unchanged marker produces no patch broadcast", async () => {
		row = makeRow({
			hashesMeta: JSON.stringify({
				v: HASHES_META_VERSION,
				pluginVersion: "1.0.0",
			}),
		})
		const ops = buildOps()
		await ops.rebuildMeta("res-1", ["hashes"])

		expect(replaced).toHaveLength(1)
		expect(patches).toHaveLength(0)
	})

	test("a concurrent rebuild of the same resource is skipped", async () => {
		const ops = buildOps(apiWithFiles(["1.jpg"]))
		const first = ops.rebuildMeta("res-1", ["hashes"])
		const second = ops.rebuildMeta("res-1", ["hashes"])
		await Promise.all([first, second])

		expect(replaced).toHaveLength(1)
		expect(patches).toHaveLength(1)
	})
})
