import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createImportResourceAPI, createPluginResourceAPI } from "./api.ts"
import type { ResourceContainer } from "./container.ts"
import { createResourceAPIFixture } from "./fixtures.ts"
import { createProbeCache } from "./probe-cache.ts"
import type { ResourceAPI } from "./types.ts"

/**
 * Minimal ranged chunk reader equivalent to the authoring helper
 * `readFileChunks` from @hoardodile/sdk-server — the host cannot
 * depend on the authoring package, and this mirrors its contract.
 */
async function* readChunks(
	api: ResourceAPI,
	path: string,
	opts: { readonly chunkSize: number },
): AsyncGenerator<Uint8Array> {
	let offset = 0
	for (;;) {
		const chunk = await api.readFile(path, {
			start: offset,
			end: offset + opts.chunkSize,
		})
		if (chunk.byteLength === 0) return
		yield chunk
		if (chunk.byteLength < opts.chunkSize) return
		offset += chunk.byteLength
	}
}

describe("createImportResourceAPI", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "import-api-test-"))
		mkdirSync(join(rootDir, "sub"))
		writeFileSync(join(rootDir, "inside.txt"), "inside")
		writeFileSync(join(rootDir, "sub", "nested.txt"), "nested")
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("readFile allows paths inside the directory", async () => {
		const api = createImportResourceAPI(rootDir)
		const data = await api.readFile("inside.txt")
		expect(new TextDecoder().decode(data)).toBe("inside")
	})

	test("readFile rejects parent directory traversal", async () => {
		const api = createImportResourceAPI(rootDir)
		await expect(api.readFile("../outside.txt")).rejects.toThrow(
			"escapes import directory",
		)
	})

	test("readFile rejects nested traversal", async () => {
		const api = createImportResourceAPI(rootDir)
		await expect(api.readFile("sub/../../outside.txt")).rejects.toThrow(
			"escapes import directory",
		)
	})

	test("readFile rejects absolute paths", async () => {
		const api = createImportResourceAPI(rootDir)
		await expect(api.readFile("/etc/passwd")).rejects.toThrow(
			"absolute paths are not allowed",
		)
	})

	test("readFile rejects empty paths", async () => {
		const api = createImportResourceAPI(rootDir)
		await expect(api.readFile("")).rejects.toThrow("path is empty")
	})

	test("readFile rejects null bytes", async () => {
		const api = createImportResourceAPI(rootDir)
		await expect(api.readFile("inside.txt\0extra")).rejects.toThrow("null byte")
	})

	test("statFile validates paths and reports real sizes", async () => {
		const api = createImportResourceAPI(rootDir)
		await expect(api.statFile("../outside.txt")).rejects.toThrow(
			"escapes import directory",
		)
		expect(await api.statFile("inside.txt")).toEqual({ sizeBytes: 6 })
	})

	test("listFileNames stays within the directory", async () => {
		const api = createImportResourceAPI(rootDir)
		const files = await api.listFileNames()
		expect([...files].sort()).toEqual(["inside.txt", "sub/nested.txt"])
	})
})

describe("createImportResourceAPI ranged reads", () => {
	let rootDir: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "import-api-range-"))
		writeFileSync(join(rootDir, "data.bin"), Buffer.from([1, 2, 3, 4, 250]))
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("range returns the requested slice", async () => {
		const api = createImportResourceAPI(rootDir)
		expect([...(await api.readFile("data.bin", { start: 1, end: 4 }))]).toEqual(
			[2, 3, 4],
		)
	})

	test("end defaults to file size and clamps", async () => {
		const api = createImportResourceAPI(rootDir)
		expect([...(await api.readFile("data.bin", { start: 3 }))]).toEqual([
			4, 250,
		])
		expect([
			...(await api.readFile("data.bin", { start: 0, end: 10_000 })),
		]).toEqual([1, 2, 3, 4, 250])
	})

	test("start past the end returns empty", async () => {
		const api = createImportResourceAPI(rootDir)
		expect(
			(await api.readFile("data.bin", { start: 100, end: 200 })).byteLength,
		).toBe(0)
	})

	test("full reads above the byte cap are rejected with guidance", async () => {
		const api = createImportResourceAPI(rootDir, { maxReadFileBytes: 4 })
		await expect(api.readFile("data.bin")).rejects.toThrow(/byte range/)
	})

	test("ranged reads above the byte cap are rejected too", async () => {
		const api = createImportResourceAPI(rootDir, { maxReadFileBytes: 3 })
		await expect(
			api.readFile("data.bin", { start: 0, end: 5 }),
		).rejects.toThrow(/byte range/)
		await expect(
			api.readFile("data.bin", { start: 0, end: 3 }),
		).resolves.toHaveLength(3)
	})
})

describe("createPluginResourceAPI ranged reads", () => {
	function stubView(content: readonly number[]): ResourceContainer {
		const bytes = Buffer.from(content)
		return {
			listEntries: async () => ["blob.bin"],
			readEntry: async () => bytes,
			readEntrySlice: async (_relPath, start, end) =>
				bytes.subarray(start, end),
			openEntryStream: async () => {
				throw new Error("not used in these tests")
			},
			resolveByteRange: async () => ({ size: bytes.byteLength }),
		}
	}

	function stubApi(content: readonly number[], maxReadFileBytes?: number) {
		return createPluginResourceAPI({
			view: stubView(content),
			probeImage: async () => undefined,
			...(maxReadFileBytes !== undefined ? { maxReadFileBytes } : {}),
		})
	}

	test("full read delegates to readEntry", async () => {
		const api = stubApi([1, 2, 3, 4, 250])
		expect([...(await api.readFile("blob.bin"))]).toEqual([1, 2, 3, 4, 250])
	})

	test("ranged read maps to readEntrySlice with clamped end", async () => {
		const api = stubApi([1, 2, 3, 4, 250])
		expect([...(await api.readFile("blob.bin", { start: 2 }))]).toEqual([
			3, 4, 250,
		])
		expect([
			...(await api.readFile("blob.bin", { start: 1, end: 10_000 })),
		]).toEqual([2, 3, 4, 250])
	})

	test("full read above the byte cap is rejected", async () => {
		const api = stubApi([1, 2, 3, 4, 250], 4)
		await expect(api.readFile("blob.bin")).rejects.toThrow(/byte range/)
	})
})

describe("createPluginResourceAPI header-slice probes", () => {
	function sliceView(head: Buffer, streams: string[]): ResourceContainer {
		return {
			listEntries: async () => ["a.png", "b.webp"],
			readEntry: async () => Buffer.alloc(0),
			readEntrySlice: async (relPath: string) =>
				relPath === "a.png" ? head : Buffer.alloc(0),
			openEntryStream: async (relPath: string) => {
				streams.push(relPath)
				return { stream: Readable.from([Buffer.from(relPath)]), size: 0 }
			},
			resolveByteRange: async () => ({ size: head.byteLength }),
		}
	}

	test("static formats probe from a header slice, no stream", async () => {
		const streams: string[] = []
		let received: unknown
		const api = createPluginResourceAPI({
			view: sliceView(Buffer.from([1, 2, 3]), streams),
			probeImage: async (source) => {
				received = source
				return { width: 10, height: 20, animated: false }
			},
		})
		await expect(api.probe("a.png")).resolves.toEqual({
			kind: "image",
			mime: "image/png",
			width: 10,
			height: 20,
			animated: false,
		})
		expect(received).toBeInstanceOf(Buffer)
		expect(streams).toEqual([])
	})

	test("animation candidates always stream", async () => {
		const streams: string[] = []
		let received: unknown
		const api = createPluginResourceAPI({
			view: sliceView(Buffer.from([1, 2, 3]), streams),
			probeImage: async (source) => {
				received = source
				return { width: 4, height: 4, animated: true }
			},
		})
		// A truncated slice cannot complete a webp frame scan, so the
		// probe must read the entry as a stream.
		await expect(api.probe("b.webp")).resolves.toEqual({
			kind: "image",
			mime: "image/webp",
			width: 4,
			height: 4,
			animated: true,
		})
		expect(received).not.toBeInstanceOf(Buffer)
		expect((received as { pipe?: unknown } | null)?.pipe).toBeTypeOf("function")
		expect(streams).toEqual(["b.webp"])
	})

	test("a decode failure is reported as failed, not as unavailable", async () => {
		const streams: string[] = []
		const api = createPluginResourceAPI({
			view: sliceView(Buffer.from([1, 2, 3]), streams),
			probeImage: async () => undefined,
		})
		await expect(api.probe("a.png")).resolves.toEqual({
			kind: "unknown",
			reason: "failed",
		})
	})

	test("a host without an image probe reports unavailable", async () => {
		const api = createPluginResourceAPI({
			view: sliceView(Buffer.from([1, 2, 3]), []),
		})
		await expect(api.probe("a.png")).resolves.toEqual({
			kind: "unknown",
			reason: "unavailable",
		})
	})
})

describe("createPluginResourceAPI content sniffing", () => {
	function contentView(entries: Readonly<Record<string, Buffer>>) {
		return {
			listEntries: async () => Object.keys(entries),
			readEntry: async (relPath: string) => entries[relPath] ?? Buffer.alloc(0),
			readEntrySlice: async (relPath: string, start: number, end: number) =>
				(entries[relPath] ?? Buffer.alloc(0)).subarray(start, end),
			openEntryStream: async (relPath: string) => {
				const bytes = entries[relPath] ?? Buffer.alloc(0)
				return { stream: Readable.from([bytes]), size: bytes.byteLength }
			},
			resolveByteRange: async (relPath: string) => ({
				size: (entries[relPath] ?? Buffer.alloc(0)).byteLength,
			}),
		} satisfies ResourceContainer
	}

	test("magic bytes beat a lying extension", async () => {
		const png = await sharp({
			create: {
				width: 8,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.png()
			.toBuffer()
		const api = createPluginResourceAPI({
			view: contentView({ "clip.mp4": png }),
			probeImage: async (source, extHint) => {
				expect(extHint).toBe(".png")
				expect(source).toBeInstanceOf(Buffer)
				return { width: 8, height: 8, animated: false }
			},
			probeAv: async () => {
				throw new Error("a PNG must never reach the av probe")
			},
		})
		await expect(api.sniff("clip.mp4")).resolves.toEqual({
			mime: "image/png",
			ext: ".png",
			kind: "image",
			source: "magic",
		})
		await expect(api.probe("clip.mp4")).resolves.toEqual({
			kind: "image",
			mime: "image/png",
			width: 8,
			height: 8,
			animated: false,
		})
	})

	test("signature-less formats fall back to the extension", async () => {
		const api = createPluginResourceAPI({
			view: contentView({ "notes.txt": Buffer.from("plain words") }),
		})
		await expect(api.sniff("notes.txt")).resolves.toEqual({
			mime: "text/plain",
			ext: ".txt",
			kind: "other",
			source: "extension",
		})
		// Identified and not media: a successful answer, not a failure.
		await expect(api.probe("notes.txt")).resolves.toEqual({
			kind: "other",
			mime: "text/plain",
		})
	})

	test("an unidentifiable entry is unsupported, and neither call rejects", async () => {
		const api = createPluginResourceAPI({
			view: contentView({ "blob.bin": Buffer.from([0, 1, 2, 3]) }),
		})
		await expect(api.sniff("blob.bin")).resolves.toBeUndefined()
		await expect(api.probe("blob.bin")).resolves.toEqual({
			kind: "unknown",
			reason: "unsupported",
		})
		await expect(api.sniff("gone.bin")).resolves.toBeUndefined()
	})
})

describe("createPluginResourceAPI probe caching", () => {
	function stubViewWithStream(): ResourceContainer {
		return {
			listEntries: async () => ["a.jpg"],
			readEntry: async () => Buffer.alloc(0),
			readEntrySlice: async () => Buffer.alloc(0),
			openEntryStream: async (relPath: string) => ({
				stream: Readable.from([Buffer.from(relPath)]),
				size: relPath.length,
			}),
			resolveByteRange: async () => ({ size: 0 }),
		}
	}

	test("repeated probes of the same entry compute once", async () => {
		let imageCalls = 0
		const api = createPluginResourceAPI({
			view: stubViewWithStream(),
			probeImage: async () => {
				imageCalls++
				return { width: 10, height: 20, animated: false }
			},
			probeCache: createProbeCache(),
			cacheScope: "res-1:0",
		})
		const expected = {
			kind: "image",
			mime: "image/jpeg",
			width: 10,
			height: 20,
			animated: false,
		}
		await expect(api.probe("a.jpg")).resolves.toEqual(expected)
		await expect(api.probe("a.jpg")).resolves.toEqual(expected)
		expect(imageCalls).toBe(1)
	})

	test("probe reuses the cached sniff instead of re-reading the header", async () => {
		let sliceReads = 0
		const view: ResourceContainer = {
			...stubViewWithStream(),
			readEntrySlice: async () => {
				sliceReads++
				return Buffer.alloc(0)
			},
		}
		const api = createPluginResourceAPI({
			view,
			probeImage: async () => ({ width: 1, height: 1, animated: false }),
			probeCache: createProbeCache(),
			cacheScope: "res-1:0",
		})
		await api.sniff("a.jpg")
		await api.probe("a.jpg")
		// One header read for the sniff; the image branch of a jpeg reads
		// its own larger slice, so exactly two reads total.
		expect(sliceReads).toBe(2)
	})

	test("a different cache scope recomputes", async () => {
		let imageCalls = 0
		const cache = createProbeCache()
		const build = (scope: string) =>
			createPluginResourceAPI({
				view: stubViewWithStream(),
				probeImage: async () => {
					imageCalls++
					return { width: 1, height: 1, animated: false }
				},
				probeCache: cache,
				cacheScope: scope,
			})
		await build("res-1:0").probe("a.jpg")
		await build("res-1:1").probe("a.jpg")
		expect(imageCalls).toBe(2)
	})

	test("without cache deps every probe computes", async () => {
		let imageCalls = 0
		const api = createPluginResourceAPI({
			view: stubViewWithStream(),
			probeImage: async () => {
				imageCalls++
				return undefined
			},
		})
		await api.probe("a.jpg")
		await api.probe("a.jpg")
		expect(imageCalls).toBe(2)
	})
})

describe("createPluginResourceAPI audio/video probes", () => {
	function avView(opened: string[]): ResourceContainer {
		return {
			listEntries: async () => ["track.mp3", "clip.mp4", "notes.txt"],
			readEntry: async () => Buffer.alloc(0),
			readEntrySlice: async () => Buffer.alloc(0),
			openEntryStream: async (relPath: string) => {
				opened.push(relPath)
				return { stream: Readable.from([Buffer.from(relPath)]), size: 0 }
			},
			resolveByteRange: async () => ({ size: 0 }),
		}
	}

	test("streams the entry with the container hint derived from the MIME type", async () => {
		const opened: string[] = []
		let opts: { mime: string; inputFormat?: string } | undefined
		const api = createPluginResourceAPI({
			view: avView(opened),
			probeAv: async (_source, received) => {
				opts = received
				return { kind: "audio", mime: received.mime, durationMs: 1000 }
			},
		})
		await expect(api.probe("track.mp3")).resolves.toEqual({
			kind: "audio",
			mime: "audio/mpeg",
			durationMs: 1000,
		})
		expect(opts).toEqual({ mime: "audio/mpeg", inputFormat: "mp3" })
		expect(opened).toEqual(["track.mp3"])
	})

	test("non-media entries never reach the av probe", async () => {
		const opened: string[] = []
		let called = false
		const api = createPluginResourceAPI({
			view: avView(opened),
			probeAv: async () => {
				called = true
				return { kind: "audio", mime: "audio/mpeg" }
			},
		})
		await expect(api.probe("notes.txt")).resolves.toEqual({
			kind: "other",
			mime: "text/plain",
		})
		expect(called).toBe(false)
		expect(opened).toEqual([])
	})

	test("repeated probes of the same entry compute once", async () => {
		let calls = 0
		const api = createPluginResourceAPI({
			view: avView([]),
			probeAv: async () => {
				calls++
				return { kind: "audio", mime: "audio/mpeg", durationMs: 1000 }
			},
			probeCache: createProbeCache(),
			cacheScope: "res-1:0",
		})
		await api.probe("track.mp3")
		await api.probe("track.mp3")
		expect(calls).toBe(1)
	})

	test("reports unavailable when the host ships no av probe", async () => {
		const api = createPluginResourceAPI({ view: avView([]) })
		await expect(api.probe("track.mp3")).resolves.toEqual({
			kind: "unknown",
			reason: "unavailable",
		})
	})
})

describe("readFileChunks", () => {
	test("yields the whole file in chunk-sized pieces", async () => {
		const contents = Array.from({ length: 10 }, (_, i) => i)
		const { api } = createResourceAPIFixture({
			contents: { "big.bin": new Uint8Array(contents) },
		})
		const chunks: number[][] = []
		for await (const chunk of readChunks(api, "big.bin", {
			chunkSize: 4,
		})) {
			chunks.push([...chunk])
		}
		expect(chunks).toEqual([
			[0, 1, 2, 3],
			[4, 5, 6, 7],
			[8, 9],
		])
	})

	test("empty file yields nothing", async () => {
		const { api } = createResourceAPIFixture({
			contents: { "empty.bin": new Uint8Array() },
		})
		const chunks: Uint8Array[] = []
		for await (const chunk of readChunks(api, "empty.bin", {
			chunkSize: 4,
		})) {
			chunks.push(chunk)
		}
		expect(chunks).toEqual([])
	})
})
