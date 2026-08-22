import { createHash } from "node:crypto"
import type { Readable } from "node:stream"
import type { ImageHashKind } from "@hoardodile/sdk-types"

/**
 * Content hashing for the `imageHashes` plugin hook. All perceptual
 * hashes derive from one 32×32 grayscale rendition (single sharp
 * decode), so requesting several kinds costs one decode:
 * - `sha256`: exact digest of the raw entry bytes (streamed).
 * - `dhash`: difference hash — 9 samples per row of the 32×32 grid
 *   (nearest-neighbour spread), adjacent pairs compared, equivalent to
 *   the standard 9×8 dHash.
 * - `phash`: standard DCT-based perceptual hash — the 32×32 grid is
 *   mean-pooled to 8×8, then the 8×8 DCT coefficients are thresholded
 *   at the median.
 *
 * The 64-bit values are hex strings (16 chars), compared by Hamming
 * distance in `@hoardodile/sdk-server` / the server's hash service.
 */

/** Side of the grayscale grid every perceptual hash is derived from. */
export const PHASH_GRID = 32

/**
 * Minimum grayscale standard deviation (0–255 scale) for an image to
 * yield perceptual hashes. Near-flat images (solid fills, blank pages)
 * hash to distance-0 neighbours of every other flat image, so they are
 * skipped — `sha256` exact hashing is unaffected.
 */
export const MIN_PERCEPTUAL_STDDEV = 8

/** Stream `stream` through a digest of `algo` and resolve its lowercase hex. */
export function hashStream(
	stream: Readable,
	algo: "md5" | "sha256",
): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash(algo)
		stream.on("data", (chunk: string | Buffer) => hash.update(chunk))
		stream.on("end", () => resolve(hash.digest("hex")))
		stream.on("error", reject)
	})
}

/**
 * dHash over a `PHASH_GRID × PHASH_GRID` grayscale buffer: 9 samples per
 * row (nearest-neighbour spread across the width), each of 8×8 bits
 * comparing a sample against its right neighbour, packed MSB-first into
 * a 16-char hex string.
 */
export function computeDHash(gray: Uint8Array, grid = PHASH_GRID): string {
	let bits = 0n
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const left = sampleAt(gray, grid, row, col)
			const right = sampleAt(gray, grid, row, col + 1)
			bits = (bits << 1n) | BigInt(left > right ? 1 : 0)
		}
	}
	return bits.toString(16).padStart(16, "0")
}

/** Grayscale value at grid position (row, col), clamped to the grid. */
function sampleAt(
	gray: Uint8Array,
	grid: number,
	row: number,
	col: number,
): number {
	const x = Math.round((col * (grid - 1)) / 8)
	return gray[row * grid + x] ?? 0
}

/**
 * pHash over a `PHASH_GRID × PHASH_GRID` grayscale buffer: the grid is
 * mean-pooled to 8×8, then the 8×8 type-II DCT coefficients (precomputed
 * cosine tables) are thresholded at their median, each bit MSB-first
 * into a 16-char hex string.
 */
export function computePHash(gray: Uint8Array, grid = PHASH_GRID): string {
	const n = 8
	const small = meanPool(gray, grid, n)
	const cos = precomputeCosines(n, n)
	const coefficients: number[] = []
	for (let v = 0; v < n; v++) {
		for (let u = 0; u < n; u++) {
			let sum = 0
			for (let y = 0; y < n; y++) {
				const cosYv = cos[v]?.[y] ?? 0
				const cosXu = cos[u] ?? []
				let rowSum = 0
				for (let x = 0; x < n; x++) {
					rowSum += (small[y * n + x] ?? 0) * (cosXu[x] ?? 0)
				}
				sum += rowSum * cosYv
			}
			const cu = u === 0 ? 1 / Math.SQRT2 : 1
			const cv = v === 0 ? 1 / Math.SQRT2 : 1
			coefficients.push(0.25 * cu * cv * sum)
		}
	}
	const median = medianOf(coefficients)
	let bits = 0n
	for (const coefficient of coefficients) {
		bits = (bits << 1n) | BigInt(coefficient > median ? 1 : 0)
	}
	return bits.toString(16).padStart(16, "0")
}

/** Mean-pool a `grid × grid` buffer into an `n × n` grid of averages. */
function meanPool(gray: Uint8Array, grid: number, n: number): number[] {
	const step = grid / n
	const pooled: number[] = []
	for (let by = 0; by < n; by++) {
		for (let bx = 0; bx < n; bx++) {
			let sum = 0
			for (let y = 0; y < step; y++) {
				for (let x = 0; x < step; x++) {
					sum += gray[(by * step + y) * grid + bx * step + x] ?? 0
				}
			}
			pooled.push(sum / (step * step))
		}
	}
	return pooled
}

/**
 * Population standard deviation of a grayscale buffer. Perceptual hashes
 * of near-flat images (solid fills, blank pages) cluster at distance 0
 * regardless of content — callers gate hash emission on this measure.
 */
export function grayStddev(gray: Uint8Array): number {
	if (gray.length === 0) return 0
	let mean = 0
	for (const value of gray) mean += value
	mean /= gray.length
	let squared = 0
	for (const value of gray) {
		const delta = value - mean
		squared += delta * delta
	}
	return Math.sqrt(squared / gray.length)
}

function precomputeCosines(grid: number, n: number): number[][] {
	const cosX: number[][] = []
	for (let k = 0; k < n; k++) {
		const row: number[] = []
		for (let x = 0; x < grid; x++) {
			row.push(Math.cos(((2 * x + 1) * k * Math.PI) / (2 * grid)))
		}
		cosX.push(row)
	}
	return cosX
}

function medianOf(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Kinds whose values come from the single grayscale decode. */
export const PERCEPTUAL_HASH_KINDS: readonly ImageHashKind[] = [
	"dhash",
	"phash",
]
