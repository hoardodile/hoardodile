import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import type { ResourceContainer } from "@hoardodile/host"
import type { FileType, ProbeResult, ResourceAPI } from "@hoardodile/sdk-server"
import {
	AUDIO_EXTS,
	extToMime,
	IMAGE_EXTS,
	mimeToKind,
	VIDEO_EXTS,
} from "@hoardodile/sdk-types/media-exts"
import { describe, expect, test } from "vitest"
import { aggregateSourceFiles } from "./source-meta.ts"
import { createTestRegistry, TEST_BUILTIN_ID } from "./test-registry.ts"

/**
 * Stand-in for the host's content sniffing: these fixtures are named
 * files with placeholder bytes, so identification comes from the
 * extension table exactly as it does for signature-less formats.
 */
function stubSniff(relPath: string): FileType | undefined {
	const ext = extname(relPath).toLowerCase()
	const mime = extToMime(ext)
	if (mime === undefined) return undefined
	return { mime, ext, kind: mimeToKind(mime), source: "extension" }
}

function stubProbe(relPath: string): ProbeResult {
	const ext = extname(relPath).toLowerCase()
	if (IMAGE_EXTS.has(ext)) {
		return {
			kind: "image",
			mime: extToMime(ext) ?? "image/jpeg",
			width: 1920,
			height: 1080,
			animated: false,
		}
	}
	if (VIDEO_EXTS.has(ext)) {
		return {
			kind: "video",
			mime: extToMime(ext) ?? "video/mp4",
			width: 1280,
			height: 720,
			durationMs: 5000,
		}
	}
	if (AUDIO_EXTS.has(ext)) {
		return {
			kind: "audio",
			mime: extToMime(ext) ?? "audio/mpeg",
			durationMs: 180_000,
			codec: "mp3",
			coverArt: { width: 600, height: 600 },
		}
	}
	const mime = extToMime(ext)
	if (mime === undefined) return { kind: "unknown", reason: "unsupported" }
	return { kind: "other", mime }
}

function createTestResourceAPI(dir: string): ResourceAPI {
	async function listFlatAll(): Promise<readonly string[]> {
		const out: string[] = []
		async function collect(current: string, prefix: string) {
			const entries = await readdir(join(dir, current), {
				withFileTypes: true,
			}).catch(() => [] as readonly never[])
			for (const e of entries) {
				if (e.name.startsWith(".")) continue
				if (e.name.includes(".uploading-")) continue
				const rel = prefix ? `${prefix}/${e.name}` : e.name
				if (e.isDirectory()) {
					await collect(join(current, e.name), rel)
				} else if (e.isFile()) {
					out.push(rel)
				}
			}
		}
		await collect(".", "")
		return out.sort((a, b) =>
			a.localeCompare(b, undefined, {
				sensitivity: "base",
				numeric: true,
			}),
		)
	}
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		async readFile(relPath: string) {
			const buf = await readFile(join(dir, relPath))
			return new Uint8Array(buf)
		},
		// Mirrors the ResourceAPI where the SourceArtifactView returns
		// every entry from the zip CD — already flat, with `/` allowed in
		// names. The on-disk recursive walk here stands in for that.
		listFileNames: listFlatAll,
		async statFile(relPath: string) {
			const full = join(dir, relPath)
			try {
				const info = statSync(full)
				return { sizeBytes: info.size }
			} catch {
				return undefined
			}
		},
		async statFiles(relPaths: readonly string[]) {
			return Promise.all(relPaths.map((p) => this.statFile(p)))
		},
		async sniff(relPath: string) {
			return stubSniff(relPath)
		},
		async probe(relPath: string) {
			return stubProbe(relPath)
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
		async download() {
			throw new Error("stub: download not configured")
		},
		async statAsset() {
			return undefined
		},
		async readAsset() {
			return new Uint8Array()
		},
		async deleteAsset() {
			return { existed: false }
		},
	}
}

const registry = createTestRegistry()

describe("aggregateSourceFiles", () => {
	function stubView(
		entries: Readonly<Record<string, number>>,
	): Pick<ResourceContainer, "listEntries" | "resolveByteRange"> {
		return {
			listEntries: async () => Object.keys(entries),
			resolveByteRange: async (relPath: string) => {
				const size = entries[relPath]
				return size === undefined ? undefined : { size }
			},
		}
	}

	test("sums entry sizes and counts", async () => {
		const meta = await aggregateSourceFiles(
			stubView({ "1.png": 4, "sub/2.png": 2 }),
		)
		expect(meta).toEqual({ sizeBytes: 6, count: 2 })
	})

	test("empty archive returns zero stats", async () => {
		const meta = await aggregateSourceFiles(stubView({}))
		expect(meta).toEqual({ sizeBytes: 0, count: 0 })
	})

	test("entries without a byte range are skipped", async () => {
		const view = {
			listEntries: async () => ["a.png", "gone.png"],
			resolveByteRange: async (relPath: string) =>
				relPath === "gone.png" ? undefined : { size: 3 },
		}
		const meta = await aggregateSourceFiles(view)
		expect(meta).toEqual({ sizeBytes: 3, count: 2 })
	})

	test("unreadable entries are skipped without failing the aggregate", async () => {
		const view = {
			listEntries: async () => ["a.png", "bad.png"],
			resolveByteRange: async (relPath: string) => {
				if (relPath === "bad.png") throw new Error("non-STORED entry")
				return { size: 3 }
			},
		}
		const meta = await aggregateSourceFiles(view)
		expect(meta).toEqual({ sizeBytes: 3, count: 2 })
	})

	test("returns undefined when the archive cannot be listed", async () => {
		const view = {
			listEntries: async (): Promise<readonly string[]> => {
				throw new Error("archive missing")
			},
			resolveByteRange: async () => ({ size: 0 }),
		}
		await expect(aggregateSourceFiles(view)).resolves.toBeUndefined()
	})
})

describe("buildPluginSourceMeta", () => {
	const entry = registry.getById(TEST_BUILTIN_ID)!

	test("gallery buildSourceMeta returns fixed cover meta", async () => {
		const dir = mkdtempSync(join(tmpdir(), "app-pm-"))
		try {
			writeFileSync(join(dir, "1.png"), "AAAA")
			writeFileSync(join(dir, "2.png"), "BB")
			const api = createTestResourceAPI(dir)
			const meta = await entry.plugin.sourceMeta!(api)
			expect(meta).toEqual({
				coverKind: "image",
				width: 1,
				height: 1,
			})
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
