import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import sharp from "sharp"
import { describe, expect, test } from "vitest"
import { createDirectoryResourceAPI } from "./directory-api.ts"
import {
	computeDHash,
	computePHash,
	grayStddev,
	hashStream,
	PHASH_GRID,
} from "./hash.ts"

function grayGrid(values: readonly number[], grid = PHASH_GRID): Uint8Array {
	return Uint8Array.from({ length: grid * grid }, (_, i) => values[i] ?? 0)
}

describe("computeDHash", () => {
	test("is deterministic and returns 16 lowercase hex chars", () => {
		const gray = grayGrid(
			Array.from({ length: PHASH_GRID * PHASH_GRID }, (_, i) => i % 256),
		)
		const first = computeDHash(gray)
		expect(first).toBe(computeDHash(gray))
		expect(first).toMatch(/^[0-9a-f]{16}$/)
	})

	test("constant image hashes to all-zero bits", () => {
		expect(computeDHash(grayGrid([]))).toBe("0000000000000000")
		// Regression: the old implementation compared the last sample
		// against out-of-bounds black, pinning the final bit of every row
		// to 1 even for a full-bright image.
		expect(computeDHash(grayGrid(Array(1024).fill(255)))).toBe(
			"0000000000000000",
		)
	})

	test("left-to-right gradient differs from right-to-left", () => {
		// Boundary at 14 sits between adjacent samples (12 and 16) so the
		// comparison grid can see the direction of the transition.
		const leftDark = grayGrid(
			Array.from({ length: PHASH_GRID * PHASH_GRID }, (_, i) => {
				const x = i % PHASH_GRID
				return x < 14 ? 0 : 255
			}),
		)
		const rightDark = grayGrid(
			Array.from({ length: PHASH_GRID * PHASH_GRID }, (_, i) => {
				const x = i % PHASH_GRID
				return x < 14 ? 255 : 0
			}),
		)
		expect(computeDHash(leftDark)).not.toBe(computeDHash(rightDark))
	})
})

describe("computePHash", () => {
	test("is deterministic and returns 16 lowercase hex chars", () => {
		const gray = grayGrid(
			Array.from({ length: PHASH_GRID * PHASH_GRID }, (_, i) => (i * 7) % 256),
		)
		const first = computePHash(gray)
		expect(first).toBe(computePHash(gray))
		expect(first).toMatch(/^[0-9a-f]{16}$/)
	})

	test("constant image hashes to all-zero bits", () => {
		const gray = grayGrid([])
		expect(computePHash(gray)).toBe("0000000000000000")
	})

	test("nearly identical images differ in only a few bits", () => {
		const base = Array.from(
			{ length: PHASH_GRID * PHASH_GRID },
			(_, i) => (i * 13 + (i % 7)) % 256,
		)
		const baseHash = computePHash(grayGrid(base))
		const noisy = base.map((v, i) => (i % 97 === 0 ? (v + 3) % 256 : v))
		const noisyHash = computePHash(grayGrid(noisy))
		const distance = popcount(
			BigInt(`0x${baseHash}`) ^ BigInt(`0x${noisyHash}`),
		)
		expect(distance).toBeLessThan(8)
	})
})

describe("grayStddev", () => {
	test("is zero for constant buffers", () => {
		expect(grayStddev(grayGrid([]))).toBe(0)
		expect(grayStddev(grayGrid(Array(1024).fill(255)))).toBe(0)
	})

	test("measures spread around the mean", () => {
		const half = grayGrid([...Array(512).fill(0), ...Array(512).fill(255)])
		expect(grayStddev(half)).toBeCloseTo(127.5, 5)
	})

	test("low-contrast ramps stay below the flat threshold", () => {
		const ramp = grayGrid(
			Array.from({ length: PHASH_GRID * PHASH_GRID }, (_, i) => {
				const x = i % PHASH_GRID
				return 100 + Math.floor((x * 20) / PHASH_GRID)
			}),
		)
		expect(grayStddev(ramp)).toBeLessThan(8)
	})
})

describe("hashStream", () => {
	test("hashes streamed bytes like node:crypto", async () => {
		const stream = Readable.from([Buffer.from("hello "), Buffer.from("world")])
		expect(await hashStream(stream, "sha256")).toBe(
			"b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
		)
	})
})

function popcount(v: bigint): number {
	let count = 0
	while (v > 0n) {
		v &= v - 1n
		count++
	}
	return count
}

// ── End-to-end through the ResourceAPI decode pipeline ──────────────

/**
 * Deterministic luminance structure: smooth R/G ramps plus a slow sine
 * ripple (period scales with the image, so it stays coherent through
 * the 32×32 hash-grid downsample — a fixed-pixel checkerboard would
 * alias differently across resize paths). The horizontal comparison
 * bits of dHash track the R ramp direction, so `flipX` inverts nearly
 * every bit — a clean "different content" pair.
 */
function makeGradient(
	width: number,
	height: number,
	opts: { readonly flipX?: boolean } = {},
): Buffer {
	const bytes = Buffer.alloc(width * height * 3)
	const period = width / 16
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3
			const ramp =
				opts.flipX === true ? 255 - (x * 255) / width : (x * 255) / width
			bytes[i] = Math.round(ramp)
			bytes[i + 1] = Math.round((y * 255) / height)
			bytes[i + 2] = Math.round(128 + 96 * Math.sin((x + y) / period))
		}
	}
	return bytes
}

async function writePng(
	dir: string,
	name: string,
	width: number,
	height: number,
	opts: { readonly flipX?: boolean } = {},
): Promise<string> {
	const path = join(dir, name)
	await sharp(makeGradient(width, height, opts), {
		raw: { width, height, channels: 3 },
	})
		.png()
		.toFile(path)
	return path
}

/** A solid-color PNG — low-information content the hash path must skip. */
async function flatPng(): Promise<Buffer> {
	return sharp(Buffer.alloc(64 * 64 * 3, 200), {
		raw: { width: 64, height: 64, channels: 3 },
	})
		.png()
		.toBuffer()
}

function hamming(a: string, b: string): number {
	return popcount(BigInt(`0x${a}`) ^ BigInt(`0x${b}`))
}

describe("computeImageHashes end-to-end (real sharp decode)", () => {
	let dir: string

	test.beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "hash-e2e-"))
	})

	test.afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	test("hashes a real PNG deterministically with the expected formats", async () => {
		await writePng(dir, "a.png", 400, 300)
		const api = createDirectoryResourceAPI(dir)

		const first = await api.computeImageHashes("a.png", [
			"sha256",
			"dhash",
			"phash",
		])
		const second = await api.computeImageHashes("a.png", [
			"sha256",
			"dhash",
			"phash",
		])

		expect(first).toEqual(second)
		expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(first?.dhash).toMatch(/^[0-9a-f]{16}$/)
		expect(first?.phash).toMatch(/^[0-9a-f]{16}$/)
	})

	test("scaled + recompressed copies stay perceptually close", async () => {
		await writePng(dir, "a.png", 400, 300)
		// Downscaled, recompressed JPEG of the same image.
		const recompressed = await sharp(makeGradient(400, 300), {
			raw: { width: 400, height: 300, channels: 3 },
		})
			.resize(200, 150)
			.jpeg({ quality: 60 })
			.toBuffer()
		writeFileSync(join(dir, "b.jpg"), recompressed)
		const api = createDirectoryResourceAPI(dir)

		const a = await api.computeImageHashes("a.png", [
			"sha256",
			"dhash",
			"phash",
		])
		const b = await api.computeImageHashes("b.jpg", [
			"sha256",
			"dhash",
			"phash",
		])

		// Byte-exact hash must differ (re-encoding changed the bytes)…
		expect(a?.sha256).not.toBe(b?.sha256)
		// …but both perceptual hashes stay within the similarity bounds
		// (mirrors SIMILAR_MAX_DISTANCE_BY_TYPE in the server hash service).
		expect(hamming(a?.dhash ?? "", b?.dhash ?? "")).toBeLessThanOrEqual(8)
		expect(hamming(a?.phash ?? "", b?.phash ?? "")).toBeLessThanOrEqual(6)
	})

	test("flat images yield no perceptual hashes but keep sha256", async () => {
		writeFileSync(join(dir, "flat.png"), await flatPng())
		const api = createDirectoryResourceAPI(dir)

		await expect(
			api.computeImageHashes("flat.png", ["dhash", "phash"]),
		).resolves.toBeUndefined()

		const withSha = await api.computeImageHashes("flat.png", [
			"sha256",
			"dhash",
			"phash",
		])
		expect(withSha?.sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(withSha?.dhash).toBeUndefined()
		expect(withSha?.phash).toBeUndefined()
	})

	test("different content lands far away in perceptual space", async () => {
		await writePng(dir, "a.png", 400, 300)
		await writePng(dir, "b.png", 400, 300, { flipX: true })
		const api = createDirectoryResourceAPI(dir)

		const a = await api.computeImageHashes("a.png", ["dhash"])
		const b = await api.computeImageHashes("b.png", ["dhash"])

		expect(hamming(a?.dhash ?? "", b?.dhash ?? "")).toBeGreaterThan(8)
	})

	test("non-image files resolve to undefined for any kinds", async () => {
		writeFileSync(join(dir, "note.txt"), "hello")
		const api = createDirectoryResourceAPI(dir)

		await expect(
			api.computeImageHashes("note.txt", ["dhash"]),
		).resolves.toBeUndefined()
		await expect(
			api.computeImageHashes("note.txt", ["sha256", "dhash"]),
		).resolves.toBeUndefined()
	})

	test("hashBytes matches node:crypto on the raw bytes", async () => {
		await writePng(dir, "a.png", 64, 64)
		const api = createDirectoryResourceAPI(dir)
		const expected = createHash("sha256")
			.update(readFileSync(join(dir, "a.png")))
			.digest("hex")
		await expect(api.hashBytes("a.png", "sha256")).resolves.toBe(expected)
	})
})
