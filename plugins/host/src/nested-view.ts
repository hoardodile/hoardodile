import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import {
	type ExtractedEntry,
	readExistingManifest,
} from "./archive/extract-archive.ts"
import type { NestedCdCache, NestedResolver } from "./archive/index.ts"
import { createNestedResolver, splitVirtualPath } from "./archive/index.ts"
import { readFileRange } from "./archive/zip-entries.ts"
import type { ResourceContainer } from "./container.ts"

/**
 * Wrap a {@link ResourceContainer} so every read operation understands
 * virtual paths (`outer!inner`, see `./archive`). The plugin API,
 * the server artifact view and the CLI directory container all funnel
 * entry reads through this wrapper, so nested-container support lands
 * everywhere (hooks, cover pipeline, thumbnails, the HTTP file route)
 * without each consumer knowing about containers.
 *
 * A virtual path resolves in two steps:
 *   1. nested zip addressing — the resolver reads the outer entry's
 *      central directory and streams the *decompressed* inner bytes;
 *   2. materialized cache addressing — when `extractCacheDir` is wired
 *      and the outer archive was extracted by the plugin API (its
 *      manifest exists in `<extractCacheDir>/<outer>/`), the inner file
 *      is served straight from disk. This is how non-zip containers
 *      (rar/7z/tar — not expressible as random-access sources) get
 *      `outer!inner` addressing after extraction, and it is strictly
 *      better than streaming: entries are seekable.
 *
 * Literal entries pass through untouched; virtual entries are only
 * addressable by name, never enumerated.
 *
 * `scope` prefixes nested-cache keys when the cache is shared across
 * containers (see {@link createNestedResolver}); `resolveSeekablePath`
 * forwards the base container's capability for literal entries and the
 * extracted file path for materialized ones.
 */
export function createNestedAwareContainer(
	base: ResourceContainer,
	nestedCdCache?: NestedCdCache,
	scope?: string,
	extractCacheDir?: string,
): ResourceContainer {
	const resolver = createNestedResolver(
		{
			sizeOf: (rel) => base.resolveByteRange(rel).then((r) => r?.size),
			readSlice: (rel, start, end) => base.readEntrySlice(rel, start, end),
		},
		{ cdCache: nestedCdCache, scope },
	)

	// Manifest reads are memoized per (cacheDir, outer): archives are
	// immutable per version, so a parsed manifest never needs invalidation.
	const manifestMemo = new Map<
		string,
		Promise<readonly ExtractedEntry[] | undefined>
	>()

	function readManifest(
		outer: string,
	): Promise<readonly ExtractedEntry[] | undefined> {
		const key = `${extractCacheDir}:${outer}`
		const pending = manifestMemo.get(key)
		if (pending !== undefined) return pending
		const work = readExistingManifest(
			join(extractCacheDir!, outer, "index.json"),
			outer,
		).catch(() => undefined)
		manifestMemo.set(key, work)
		return work
	}

	type MaterializedEntry = {
		readonly kind: "materialized"
		readonly absPath: string
		readonly sizeBytes: number
	}

	/**
	 * Resolve `outer!inner` against the extraction cache: the inner path
	 * must appear in the outer's manifest (the manifest paths were
	 * sanitized at extraction time, so this is a whitelist — no
	 * traversal can reach outside the cache dir).
	 */
	async function resolveMaterialized(
		rel: string,
	): Promise<MaterializedEntry | undefined> {
		if (extractCacheDir === undefined) return undefined
		const parts = splitVirtualPath(rel)
		if (parts === undefined) return undefined
		const { outer, inner } = parts
		const manifest = await readManifest(outer)
		const entry = manifest?.find((e) => e.path === inner)
		if (entry === undefined) return undefined
		return {
			kind: "materialized",
			absPath: join(extractCacheDir, outer, inner),
			sizeBytes: entry.sizeBytes,
		}
	}

	async function resolve(rel: string) {
		const nested = await resolver.resolve(rel)
		if (nested.kind === "container") return nested
		const materialized = await resolveMaterialized(rel)
		return materialized ?? nested
	}

	async function readEntrySlice(
		rel: string,
		start: number,
		end: number,
	): Promise<Buffer> {
		const resolved = await resolve(rel)
		if (resolved.kind === "literal") {
			return base.readEntrySlice(rel, start, end)
		}
		if (resolved.kind === "materialized") {
			// readEntrySlice's `end` is exclusive; readFileRange's is
			// inclusive.
			return readFileRange(resolved.absPath, start, end - 1)
		}
		// Slice the decompressed bytes: consume the stream only up to
		// `end` so head reads (sniff/probe windows) stay bounded.
		return readVirtualSlice(() => resolved.openStream(), start, end)
	}

	async function openEntryStream(rel: string): Promise<{
		readonly stream: Readable
		readonly size: number
		readonly mtimeMs?: number
		readonly path?: string
	}> {
		const resolved = await resolve(rel)
		if (resolved.kind === "literal") {
			return base.openEntryStream(rel)
		}
		if (resolved.kind === "materialized") {
			return {
				stream: createReadStream(resolved.absPath),
				size: resolved.sizeBytes,
				path: resolved.absPath,
			}
		}
		return { stream: resolved.openStream(), size: resolved.entry.sizeBytes }
	}

	async function readEntry(rel: string): Promise<Buffer> {
		const resolved = await resolve(rel)
		if (resolved.kind === "literal") {
			return base.readEntry(rel)
		}
		if (resolved.kind === "materialized") {
			return readFile(resolved.absPath)
		}
		return buffer(resolved.openStream())
	}

	async function resolveByteRange(
		rel: string,
	): Promise<{ readonly size: number } | undefined> {
		const resolved = await resolve(rel)
		if (resolved.kind === "literal") {
			return base.resolveByteRange(rel)
		}
		if (resolved.kind === "materialized") {
			return { size: resolved.sizeBytes }
		}
		return { size: resolved.entry.sizeBytes }
	}

	async function resolveSeekablePath(rel: string): Promise<string | undefined> {
		const resolved = await resolve(rel)
		if (resolved.kind === "literal") {
			return base.resolveSeekablePath?.(rel)
		}
		if (resolved.kind === "materialized") {
			// Extracted files are real on-disk entries — libvips/ffmpeg
			// can mmap/open them directly instead of streaming.
			return resolved.absPath
		}
		return undefined
	}

	return {
		listEntries: base.listEntries,
		readEntry,
		readEntrySlice,
		openEntryStream,
		resolveByteRange,
		resolveSeekablePath,
	}
}

/**
 * Read `[start, end)` of an entry stream without buffering more than
 * `end` bytes. STORED and DEFLATE entries alike stream through this
 * path, so a truncated header slice never inflates the whole entry.
 */
async function readVirtualSlice(
	openStream: () => Readable,
	start: number,
	end: number,
): Promise<Buffer> {
	if (end <= start) return Buffer.alloc(0)
	const chunks: Buffer[] = []
	let collected = 0
	await new Promise<void>((resolveDone, rejectDone) => {
		const stream = openStream()
		stream.on("data", (chunk: Buffer | string) => {
			const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
			const need = end - collected
			if (need <= 0) {
				stream.destroy()
				resolveDone()
				return
			}
			const take = bytes.subarray(0, Math.min(need, bytes.length))
			chunks.push(take)
			collected += take.length
			if (collected >= end) {
				stream.destroy()
				resolveDone()
			}
		})
		stream.on("end", () => resolveDone())
		stream.on("error", (err) => rejectDone(err))
	})
	const full = Buffer.concat(chunks, collected)
	const sliceStart = Math.min(start, full.length)
	return full.subarray(sliceStart)
}

/** Resolver instance type re-export for callers that build their own views. */
export type { NestedResolver }
