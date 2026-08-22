import type {
	DuplicateImagesEntry,
	DuplicateImagesResult,
	IntraSimilarGroup,
	IntraSimilarResult,
	Resource,
	SimilarFileMatch,
	SimilarImagesEntry,
	SimilarImagesResult,
} from "@hoardodile/schemas"
import type { ResourceHashRow } from "./repo.ts"

/**
 * Hash-based duplicate detection and image similarity for resources.
 * Rows are produced by the owning plugin's `imageHashes` hook (host-side
 * sha256 / dHash / pHash computation) and live in `resource_hashes`.
 *
 * - Exact duplicates: byte-identical files (sha256) via indexed equality
 *   lookups.
 * - Similar images: perceptual hashes (`bits > 32`, e.g. dhash/phash
 *   with 64 bits) compared by Hamming distance, thresholded per type
 *   (see {@link SIMILAR_MAX_DISTANCE_BY_TYPE}). The candidate set per
 *   hash type is small enough (thousands of rows) that a linear scan in
 *   JS is effectively free — no BK-tree or SQL popcount machinery.
 * - Similar within one resource: the same comparison run over the
 *   resource's own rows, clustered transitively so a gallery holding
 *   ten near-identical shots surfaces one group instead of nothing.
 *
 * Degenerate perceptual values (all-zero / all-one bits) are skipped
 * everywhere: they mark low-information images (solid fills, blank
 * pages) that would cluster at distance 0 regardless of content.
 * All queries exclude soft-deleted resources.
 */

/**
 * Max Hamming distance for two hashes to count as similar, per hash
 * type. Perceptual kinds differ in their statistical behaviour (pHash
 * coefficients cluster tighter than dHash deltas), so the threshold is
 * type-aware; unknown plugin-defined kinds fall back to
 * {@link SIMILAR_DEFAULT_MAX_DISTANCE}.
 */
export const SIMILAR_MAX_DISTANCE_BY_TYPE: Readonly<Record<string, number>> = {
	dhash: 8,
	phash: 6,
}

/** Fallback threshold for hash types without a dedicated entry. */
export const SIMILAR_DEFAULT_MAX_DISTANCE = 10

/** Threshold for a hash type (see {@link SIMILAR_MAX_DISTANCE_BY_TYPE}). */
export function maxDistanceFor(type: string): number {
	return SIMILAR_MAX_DISTANCE_BY_TYPE[type] ?? SIMILAR_DEFAULT_MAX_DISTANCE
}

/** Max result entries per query. */
export const SIMILAR_RESULT_LIMIT = 20

/**
 * Max perceptual rows a resource may hold before the within-resource
 * scan bails — the pairwise pass is O(n²) and manga-style resources
 * hash only their cover, so real workloads stay far below this.
 */
export const SIMILAR_WITHIN_MAX_ROWS = 1000

/** Rows whose bit width marks them as perceptual (hamming-compared). */
export function isPerceptualHash(row: Pick<ResourceHashRow, "bits">): boolean {
	return row.bits !== null && row.bits > 32
}

/**
 * A perceptual hash with no information content: every bit 0 or every
 * bit 1. Near-flat images produce these and would match each other at
 * distance 0.
 */
export function isDegenerateHash(value: string): boolean {
	const v = BigInt(`0x${value}`)
	const allOnes = (1n << BigInt(value.length * 4)) - 1n
	return v === 0n || v === allOnes
}

/** Hamming distance between two lowercase hex hashes (any bit width). */
export function hammingDistance(a: string, b: string): number {
	const x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
	let count = 0
	let v = x
	while (v > 0n) {
		v &= v - 1n
		count++
	}
	return count
}

export type ResHashServiceDeps = {
	readonly listHashes: (resourceId: string) => readonly ResourceHashRow[]
	readonly listHashesOfType: (
		type: string,
		excludeResourceId?: string,
	) => readonly ResourceHashRow[]
	readonly findExactHashMatches: (
		type: string,
		value: string,
		excludeResourceId: string,
	) => readonly ResourceHashRow[]
	/** Row → API resource (for result payloads). */
	readonly toResource: (resourceId: string) => Resource
}

/** One perceptual hash of an arbitrary query image. */
export type QueryHash = {
	readonly type: string
	readonly value: string
}

/** One live resource matched by a query image, before card hydration. */
export type QueryHashMatch = {
	readonly resourceId: string
	readonly files: SimilarFileMatch[]
}

export type ResHashService = {
	/**
	 * Other live resources containing images perceptually similar to the
	 * query resource's images, ranked by best Hamming distance (within
	 * the type threshold). Empty when the resource has no perceptual
	 * hashes or nothing matches.
	 */
	readonly similarImages: (resourceId: string) => SimilarImagesResult
	/**
	 * Groups of the query resource's own files that are perceptually
	 * similar to each other, largest groups first. Empty when fewer than
	 * two files relate.
	 */
	readonly similarWithinResource: (resourceId: string) => IntraSimilarResult
	/**
	 * Other live resources containing byte-identical files (exact hash
	 * matches) with the query resource. Empty when nothing matches.
	 */
	readonly duplicateImages: (resourceId: string) => DuplicateImagesResult
	/**
	 * Live resources holding images perceptually similar to the given
	 * query hashes (an arbitrary uploaded image), ranked by best Hamming
	 * distance exactly like {@link similarImages}. Empty when no query
	 * hash is perceptual or nothing matches.
	 */
	readonly similarToQueryHashes: (
		queries: readonly QueryHash[],
	) => readonly QueryHashMatch[]
}

export function buildResHashService(deps: ResHashServiceDeps): ResHashService {
	const { listHashes, listHashesOfType, findExactHashMatches, toResource } =
		deps

	function similarImages(resourceId: string): SimilarImagesResult {
		const perceptualTypes = new Set(
			listHashes(resourceId)
				.filter(isPerceptualHash)
				.map((row) => row.type),
		)
		const entries: SimilarImagesEntry[] = []
		for (const type of perceptualTypes) {
			const queryValues = listHashes(resourceId).filter(
				(row) =>
					row.type === type &&
					isPerceptualHash(row) &&
					!isDegenerateHash(row.value),
			)
			for (const candidate of listHashesOfType(type, resourceId)) {
				if (candidate.bits === null) continue
				if (isDegenerateHash(candidate.value)) continue
				const maxDistance = maxDistanceFor(type)
				const best = queryValues.reduce(
					(bestSoFar, query) => {
						const distance = hammingDistance(query.value, candidate.value)
						return distance < bestSoFar.distance ? { distance } : bestSoFar
					},
					{ distance: Number.MAX_SAFE_INTEGER },
				)
				if (best.distance > maxDistance) continue
				const existing = entries.find(
					(entry) => entry.resource.id === candidate.resourceId,
				)
				const fileMatch = {
					scope: candidate.scope,
					bits: candidate.bits,
					distance: best.distance,
				}
				if (existing !== undefined) {
					mergeFileMatch(existing.files, fileMatch)
				} else {
					entries.push({
						resource: toResource(candidate.resourceId),
						files: [fileMatch],
					})
				}
			}
		}
		for (const entry of entries) {
			entry.files.sort((a, b) => a.distance - b.distance)
		}
		entries.sort((a, b) => bestDistance(a) - bestDistance(b))
		return entries.slice(0, SIMILAR_RESULT_LIMIT)
	}

	function similarWithinResource(resourceId: string): IntraSimilarResult {
		const rows = listHashes(resourceId).filter(
			(row) => isPerceptualHash(row) && !isDegenerateHash(row.value),
		)
		// "Fewer than two files relate" — files, not rows: a single file
		// carrying several perceptual kinds (dhash + phash) is one scope,
		// and must never report itself as a similarity group.
		if (
			new Set(rows.map((row) => row.scope)).size < 2 ||
			rows.length > SIMILAR_WITHIN_MAX_ROWS
		) {
			return []
		}

		const clusters = clusterPerceptualRows(rows)
		const groups: IntraSimilarGroup[] = []
		for (const members of clusters.values()) {
			// A file carries one row per hash type; fold them back into a
			// single entry per scope, keeping the best distance across
			// types. A cluster that collapses to fewer than two files is
			// one file's own kind rows unioned together — not a group.
			const byScope = new Map<string, ResourceHashRow[]>()
			for (const row of members) {
				const list = byScope.get(row.scope)
				if (list === undefined) byScope.set(row.scope, [row])
				else list.push(row)
			}
			const files = [...byScope.values()].map((scopeRows) => {
				const first = scopeRows[0]
				if (first === undefined) throw new Error("unreachable")
				let distance = Number.MAX_SAFE_INTEGER
				for (const row of scopeRows) {
					const best = bestPairDistance(members, row)
					if (best < distance) distance = best
				}
				return {
					scope: first.scope,
					bits: first.bits as number,
					distance,
				}
			})
			if (files.length < 2) continue
			files.sort((a, b) => a.distance - b.distance)
			groups.push({ files })
		}
		groups.sort(
			(a, b) =>
				b.files.length - a.files.length ||
				(a.files[0]?.distance ?? 0) - (b.files[0]?.distance ?? 0),
		)
		return groups
	}

	function duplicateImages(resourceId: string): DuplicateImagesResult {
		const entries: DuplicateImagesEntry[] = []
		for (const row of listHashes(resourceId)) {
			if (isPerceptualHash(row)) continue
			for (const match of findExactHashMatches(
				row.type,
				row.value,
				resourceId,
			)) {
				const existing = entries.find(
					(entry) => entry.resource.id === match.resourceId,
				)
				const fileMatch = {
					scope: row.scope,
					otherScope: match.scope,
					type: row.type,
				}
				if (existing !== undefined) {
					existing.files.push(fileMatch)
				} else {
					entries.push({
						resource: toResource(match.resourceId),
						files: [fileMatch],
					})
				}
			}
		}
		entries.sort((a, b) => b.files.length - a.files.length)
		return entries
	}

	function similarToQueryHashes(
		queries: readonly QueryHash[],
	): readonly QueryHashMatch[] {
		const entries: QueryHashMatch[] = []
		for (const type of new Set(queries.map((query) => query.type))) {
			// Degenerate queries (near-flat uploads) carry no information;
			// they would match every other flat image at distance 0.
			const queryValues = queries.filter(
				(query) => query.type === type && !isDegenerateHash(query.value),
			)
			if (queryValues.length === 0) continue
			const maxDistance = maxDistanceFor(type)
			for (const candidate of listHashesOfType(type)) {
				if (candidate.bits === null) continue
				if (isDegenerateHash(candidate.value)) continue
				const best = queryValues.reduce(
					(bestSoFar, query) => {
						const distance = hammingDistance(query.value, candidate.value)
						return distance < bestSoFar.distance ? { distance } : bestSoFar
					},
					{ distance: Number.MAX_SAFE_INTEGER },
				)
				if (best.distance > maxDistance) continue
				const existing = entries.find(
					(entry) => entry.resourceId === candidate.resourceId,
				)
				const fileMatch: SimilarFileMatch = {
					scope: candidate.scope,
					bits: candidate.bits,
					distance: best.distance,
				}
				if (existing !== undefined) {
					mergeFileMatch(existing.files, fileMatch)
				} else {
					entries.push({
						resourceId: candidate.resourceId,
						files: [fileMatch],
					})
				}
			}
		}
		for (const entry of entries) {
			entry.files.sort((a, b) => a.distance - b.distance)
		}
		entries.sort((a, b) => bestDistance(a) - bestDistance(b))
		return entries.slice(0, SIMILAR_RESULT_LIMIT)
	}

	return {
		similarImages,
		similarWithinResource,
		duplicateImages,
		similarToQueryHashes,
	}
}

function bestDistance(entry: {
	readonly files: readonly { readonly distance: number }[]
}): number {
	let best = Number.MAX_SAFE_INTEGER
	for (const file of entry.files) {
		if (file.distance < best) best = file.distance
	}
	return best
}

/**
 * Fold one matched file into an entry's file list: a file carries one
 * row per perceptual kind (dhash + phash), so one scope can match once
 * per kind. Entries keep a single entry per scope with the best
 * (smallest) distance — exactly the folding the within-resource
 * clustering applies, so counts and thumbnail strips show distinct
 * files, never the same image repeated per kind.
 */
function mergeFileMatch(
	files: SimilarFileMatch[],
	match: SimilarFileMatch,
): void {
	const existing = files.find((file) => file.scope === match.scope)
	if (existing !== undefined) {
		if (match.distance < existing.distance) {
			existing.bits = match.bits
			existing.distance = match.distance
		}
		return
	}
	files.push(match)
}

/**
 * Union-find over rows of one resource: same-type pairs within the type
 * threshold are unioned (a dhash union and a phash union that share a
 * file merge), so groups are the transitive closures of "similar to".
 * Returns clusters with at least two members, keyed by row index.
 */
function clusterPerceptualRows(
	rows: readonly ResourceHashRow[],
): Map<number, ResourceHashRow[]> {
	const parent = rows.map((_, i) => i)
	const find = (i: number): number => {
		let root = i
		while (parent[root] !== root) root = parent[root] as number
		while (parent[i] !== i) {
			const next = parent[i] as number
			parent[i] = root
			i = next
		}
		return root
	}
	const union = (a: number, b: number): void => {
		const ra = find(a)
		const rb = find(b)
		if (ra !== rb) parent[ra] = rb
	}

	for (let i = 0; i < rows.length; i++) {
		for (let j = i + 1; j < rows.length; j++) {
			const a = rows[i]
			const b = rows[j]
			if (a === undefined || b === undefined) continue
			if (a.type !== b.type) continue
			if (hammingDistance(a.value, b.value) <= maxDistanceFor(a.type)) {
				union(i, j)
			}
		}
	}

	// Rows of the same file (one per hash type) always belong together —
	// this is what lets a dhash cluster and a phash cluster that share a
	// file merge into one group.
	const byScope = new Map<string, number[]>()
	for (let i = 0; i < rows.length; i++) {
		const scope = rows[i]?.scope
		if (scope === undefined) continue
		const indices = byScope.get(scope)
		if (indices === undefined) byScope.set(scope, [i])
		else indices.push(i)
	}
	for (const indices of byScope.values()) {
		const first = indices[0]
		if (first === undefined) continue
		for (let k = 1; k < indices.length; k++) {
			const next = indices[k]
			if (next !== undefined) union(first, next)
		}
	}

	const clusters = new Map<number, ResourceHashRow[]>()
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		if (row === undefined) continue
		const root = find(i)
		const members = clusters.get(root)
		if (members === undefined) clusters.set(root, [row])
		else members.push(row)
	}
	return clusters
}

/**
 * Best Hamming distance from `row` to any other member of `members`.
 * `members` is small (a similarity cluster), so re-scanning the pairs
 * instead of memoizing the pairwise matrix is intentionally cheap.
 */
function bestPairDistance(
	members: readonly ResourceHashRow[],
	row: ResourceHashRow,
): number {
	let best = Number.MAX_SAFE_INTEGER
	for (const other of members) {
		if (other === row || other.type !== row.type) continue
		const distance = hammingDistance(row.value, other.value)
		if (distance < best) best = distance
	}
	return best
}
