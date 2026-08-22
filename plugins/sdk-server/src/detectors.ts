import type { Detection, ResourceAPI } from "@hoardodile/sdk-types"
import { err, ok } from "@hoardodile/sdk-types"
import type { MediaKind } from "@hoardodile/sdk-types/media-exts"
import { extname, mapConcurrent } from "./helpers.ts"

/** A detector evaluates a resource and returns a {@link Detection}. */
export type Detector = (api: ResourceAPI) => Promise<Detection>

/** Sniff fan-out bound: detection reads a small header per candidate. */
const SNIFF_CONCURRENCY = 8

/** Detect when all given detectors pass. */
export function all(...detectors: readonly Detector[]): Detector {
	return async function detectAll(api) {
		for (const detector of detectors) {
			const result = await detector(api)
			if (!result.ok) return result
		}
		return ok()
	}
}

/** Detect when at least one given detector passes. */
export function any(...detectors: readonly Detector[]): Detector {
	return async function detectAny(api) {
		for (const detector of detectors) {
			const result = await detector(api)
			if (result.ok) return ok()
		}
		return err({ reasons: ["no-detector-matched"] })
	}
}

/** Negate a detector: passes when the wrapped detector fails. */
export function not(detector: Detector, reasons: readonly string[]): Detector {
	return async function detectNot(api) {
		const result = await detector(api)
		return result.ok ? err({ reasons }) : ok()
	}
}

/**
 * Detect when the resource has at least one file with any of the given
 * extensions.
 *
 * Extension matching is the fast path: it costs one filename comparison
 * and no reads. It is also only as good as the names — reach for
 * {@link hasKind} or {@link hasMime} when the archive may carry
 * mislabelled or extension-less files.
 */
export function hasExt(extensions: ReadonlySet<string>): Detector {
	return async function detectHasExt(api) {
		const files = await api.listFileNames()
		const has = files.some((name) => extensions.has(extname(name)))
		return has ? ok() : err({ reasons: ["required-extension"] })
	}
}

/**
 * Detect when at least one file's **content** belongs to `kind`. Reads a
 * small header per file (bounded fan-out, short-circuits on the first
 * match), so a resource of images detects as such no matter what the
 * files are called.
 */
export function hasKind(kind: MediaKind): Detector {
	return async function detectHasKind(api) {
		const matched = await someFileType(api, (type) => type.kind === kind)
		return matched ? ok() : err({ reasons: [`required-kind:${kind}`] })
	}
}

/**
 * Detect when at least one file's sniffed MIME type matches `pattern` —
 * the content-based counterpart of {@link hasName}, for formats a media
 * kind cannot express (`application/epub+zip`, `application/pdf`).
 *
 * A string matches by exact equality (use a `RegExp` for prefix or
 * wildcard matching).
 */
export function hasMime(pattern: RegExp | string): Detector {
	return async function detectHasMime(api) {
		const matched = await someFileType(api, (type) =>
			typeof pattern === "string"
				? type.mime === pattern
				: pattern.test(type.mime),
		)
		return matched ? ok() : err({ reasons: ["required-mime"] })
	}
}

/**
 * True when any file's sniffed type satisfies `predicate`. Files are
 * sniffed in bounded parallel batches and the walk stops at the first
 * match, so a 10k-entry archive does not pay for a full scan.
 */
async function someFileType(
	api: ResourceAPI,
	predicate: (
		type: NonNullable<Awaited<ReturnType<ResourceAPI["sniff"]>>>,
	) => boolean,
): Promise<boolean> {
	const files = await api.listFileNames()
	for (let i = 0; i < files.length; i += SNIFF_CONCURRENCY) {
		const batch = files.slice(i, i + SNIFF_CONCURRENCY)
		const types = await mapConcurrent(batch, SNIFF_CONCURRENCY, (name) =>
			api.sniff(name),
		)
		if (types.some((type) => type !== undefined && predicate(type))) return true
	}
	return false
}

/** Detect when the resource has a file whose name matches the given regex. */
export function hasName(pattern: RegExp): Detector {
	return async function detectHasName(api) {
		const files = await api.listFileNames()
		const has = files.some((name) => pattern.test(name))
		return has ? ok() : err({ reasons: ["required-file"] })
	}
}

/** Detect when the resource has at least `count` files. */
export function minFiles(count: number): Detector {
	return async function detectMinFiles(api) {
		const files = await api.listFileNames()
		return files.length >= count
			? ok()
			: err({ reasons: ["insufficient-files"] })
	}
}

/** File-selection helpers that operate on a {@link ResourceAPI}. */
export const files = {
	/**
	 * Return the first file matching any of the given extension sets,
	 * or `undefined` when none match.
	 */
	async firstMatching(
		api: ResourceAPI,
		...extensions: readonly ReadonlySet<string>[]
	): Promise<string | undefined> {
		const allFiles = await api.listFileNames()
		for (const filename of allFiles) {
			const ext = extname(filename)
			for (const set of extensions) {
				if (set.has(ext)) return filename
			}
		}
		return undefined
	},

	/**
	 * Return the first file whose **content** belongs to one of the given
	 * media kinds, or `undefined` when none does. The content-based
	 * counterpart of {@link files.firstMatching} — pick it when the
	 * chosen file is going to be decoded anyway (a cover, a first page),
	 * where a mislabelled name would otherwise cost a failed render.
	 */
	async firstOfKind(
		api: ResourceAPI,
		...kinds: readonly MediaKind[]
	): Promise<string | undefined> {
		const wanted = new Set<MediaKind>(kinds)
		const allFiles = await api.listFileNames()
		for (let i = 0; i < allFiles.length; i += SNIFF_CONCURRENCY) {
			const batch = allFiles.slice(i, i + SNIFF_CONCURRENCY)
			const types = await mapConcurrent(batch, SNIFF_CONCURRENCY, (name) =>
				api.sniff(name),
			)
			const hit = types.findIndex(
				(type) => type !== undefined && wanted.has(type.kind),
			)
			if (hit !== -1) return batch[hit]
		}
		return undefined
	},
} as const
