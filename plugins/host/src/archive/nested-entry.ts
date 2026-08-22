import type { Readable } from "node:stream"
import { invalid } from "../errors.ts"
import { SNIFF_WINDOW_BYTES, sniffContainerFormat } from "./format.ts"
import type { NestedCdCache } from "./nested-cd-cache.ts"
import {
	type ArchiveSource,
	listZipEntriesFromSource,
	openZipEntryStream,
} from "./zip-entries.ts"

/**
 * Container-entry addressing: plugin hooks (and the server view) may
 * reference a file *inside* a container entry with the virtual path
 * `outer!inner` — e.g. `manga.cbz!Chapter 1/001.jpg`. This module owns
 * the resolution rules and the zip listing (format identification
 * lives in `format.ts`); nested containers reuse `zip-entries.ts` over
 * a range source. Zip is the only addressable nested format —
 * tar/7z/rar/xz/gzip are whole-archive formats (extractable via 7-Zip,
 * not addressable by single entry).
 *
 * Ambiguity rule: `outer` is treated as a container only when its magic
 * bytes say so (zip) AND the archive actually contains `inner`;
 * otherwise the whole path is the literal container entry. A file whose
 * name contains `!` therefore stays addressable.
 */

/** The virtual-path separator between an outer entry and an inner one. */
export const VIRTUAL_PATH_SEPARATOR = "!"

/**
 * Read interface an outer container must satisfy. Both the plugin-side
 * `ResourceContainer` and the server's artifact view provide these — the
 * virtual resolver is deliberately minimal so it composes with either.
 */
export type OuterEntrySource = {
	/** Byte length of a literal entry; `undefined` when absent. */
	readonly sizeOf: (rel: string) => Promise<number | undefined>
	/** Read `[start, end)` of a literal entry (`end` exclusive). */
	readonly readSlice: (
		rel: string,
		start: number,
		end: number,
	) => Promise<Buffer>
}

/** A unified, format-agnostic inner entry. */
export type ArchiveEntry = {
	readonly name: string
	readonly sizeBytes: number
}

/** An inner entry plus its stream opener (format handles attached). */
export type OpenableArchiveEntry = ArchiveEntry & {
	readonly openStream: () => Readable
}

export type PathResolution =
	| { readonly kind: "literal" }
	| {
			readonly kind: "container"
			readonly outer: string
			readonly entry: ArchiveEntry
			/** Decompressed bytes of the inner entry. */
			readonly openStream: () => Readable
	  }

export type NestedResolver = {
	/**
	 * Resolve `path` against the outer container. `kind: "container"`
	 * means the path addressed a file inside a nested zip/tar; anything
	 * else keeps the literal semantics (a plain entry, possibly one whose
	 * name happens to contain `!`).
	 */
	readonly resolve: (path: string) => Promise<PathResolution>
	/**
	 * List every file entry of the container `outer`. Resolves to
	 * `undefined` when `outer` is not a container (or does not exist).
	 * Memoized per outer name for the resolver's lifetime.
	 */
	readonly list: (
		outer: string,
	) => Promise<readonly OpenableArchiveEntry[] | undefined>
}

/** Split `outer!inner` at the first separator. */
export function splitVirtualPath(path: string):
	| {
			readonly outer: string
			readonly inner: string
	  }
	| undefined {
	const sep = path.indexOf(VIRTUAL_PATH_SEPARATOR)
	if (sep <= 0) return undefined
	const inner = path.slice(sep + 1)
	if (inner.length === 0) return undefined
	return { outer: path.slice(0, sep), inner }
}

/** Wrap an outer container entry as a {@link ArchiveSource} (real size). */
export function createOuterArchiveSource(
	outer: OuterEntrySource,
	outerName: string,
	size: number,
): ArchiveSource {
	return {
		size,
		readRange: (start, end) => outer.readSlice(outerName, start, end + 1),
	}
}

/**
 * Build a resolver over one outer container. Archive listings are
 * memoized per outer entry name for the resolver's lifetime (a
 * resource-level operation parses each nested archive at most once),
 * and — when a {@link NestedCdCache} is provided — across resolver
 * instances, so a multi-hook pass parses each nested archive once.
 *
 * `scope` disambiguates cache keys when one shared cache serves many
 * containers (e.g. every resource of a server): keys become
 * `<scope>:<outerName>`, so two resources holding same-named archives
 * never serve each other's listings.
 */
export function createNestedResolver(
	outer: OuterEntrySource,
	opts: { readonly cdCache?: NestedCdCache; readonly scope?: string } = {},
): NestedResolver {
	const cdCache = opts.cdCache
	const scope = opts.scope
	const cacheKey = (outerName: string): string =>
		scope === undefined ? outerName : `${scope}:${outerName}`
	const listingMemo = new Map<
		string,
		Promise<readonly ListedEntry[] | undefined>
	>()
	const listedMemo = new Map<
		string,
		Promise<readonly OpenableArchiveEntry[] | undefined>
	>()

	function listOuter(
		outerName: string,
	): Promise<readonly ListedEntry[] | undefined> {
		const key = cacheKey(outerName)
		const pending = listingMemo.get(key)
		if (pending !== undefined) return pending
		const shared = cdCache?.get(key) as
			| Promise<readonly ListedEntry[] | undefined>
			| undefined
		if (shared !== undefined) {
			listingMemo.set(key, shared)
			return shared
		}
		const work = listOuterOnce(outerName)
		listingMemo.set(key, work)
		cdCache?.set(key, work)
		void work.then(
			() => undefined,
			() => undefined,
		)
		return work
	}

	async function listOuterOnce(
		outerName: string,
	): Promise<readonly ListedEntry[] | undefined> {
		const size = await outer.sizeOf(outerName)
		if (size === undefined) return undefined
		if (size === 0) return undefined
		const head = await outer.readSlice(
			outerName,
			0,
			Math.min(size, SNIFF_WINDOW_BYTES),
		)
		const format = sniffContainerFormat(head)
		// Zip is the only addressable nested format; tar/7z/rar/xz/gzip
		// are whole-archive formats and report "not a container".
		if (format !== "zip") return undefined
		const source = createOuterArchiveSource(outer, outerName, size)
		const records = await listZipEntriesFromSource(source)
		return records.map((r) => ({
			name: r.name,
			sizeBytes: r.uncompressedSize,
			outerSize: size,
			zip: r,
		}))
	}

	async function resolve(path: string): Promise<PathResolution> {
		const parts = splitVirtualPath(path)
		if (parts === undefined) return { kind: "literal" }
		const { outer: outerName, inner } = parts
		const entries = await listOuter(outerName)
		const found = entries?.find((e) => e.name === inner)
		if (found === undefined) return { kind: "literal" }
		return {
			kind: "container",
			outer: outerName,
			entry: { name: found.name, sizeBytes: found.sizeBytes },
			openStream: () => openListedEntry(outer, outerName, found),
		}
	}

	async function list(
		outerName: string,
	): Promise<readonly OpenableArchiveEntry[] | undefined> {
		const pending = listedMemo.get(outerName)
		if (pending !== undefined) return pending
		const work = listOuter(outerName).then((entries) =>
			entries === undefined
				? undefined
				: entries.map((e) => listedWithStream(outer, outerName, e)),
		)
		listedMemo.set(outerName, work)
		void work.then(
			() => undefined,
			() => undefined,
		)
		return work
	}

	return { resolve, list }
}

type ListedEntry = ArchiveEntry & {
	/** Byte size of the outer container entry. */
	readonly outerSize: number
	readonly zip?: import("./zip-entries.ts").ZipEntry
}

function listedWithStream(
	outer: OuterEntrySource,
	outerName: string,
	entry: ListedEntry,
): OpenableArchiveEntry {
	return {
		name: entry.name,
		sizeBytes: entry.sizeBytes,
		openStream: () => openListedEntry(outer, outerName, entry),
	}
}

function openListedEntry(
	outer: OuterEntrySource,
	outerName: string,
	entry: ListedEntry,
): Readable {
	const source = createOuterArchiveSource(outer, outerName, entry.outerSize)
	if (entry.zip !== undefined) return openZipEntryStream(source, entry.zip)
	throw invalid(
		"resource.archive_open_failed",
		`entry "${entry.name}" has no stream backend`,
		{ name: entry.name },
	)
}
