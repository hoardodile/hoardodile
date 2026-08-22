/**
 * Micro-benchmarks (tinybench) for the IO hot paths: directory listing
 * + direct file window reads (the bare-file resource read path),
 * zip central-directory parse (nested archives — yauzl since the
 * hand-rolled parser was removed, plus the 7-Zip listing counterpart),
 * image probe latency (stream + reopenable), and the host-side probe
 * LRU. Each task is a hot loop over the production function; results
 * are flattened into the report.
 *
 * The probe tasks feed real >16MB and >32MB noise images: slice tasks
 * measure the production header-slice path (a 256KB header slice probed
 * as a buffer), the stream task measures the no-readRange fallback
 * (libvips full-reads non-seekable input). Losing the slice path — or
 * reintroducing whole-entry buffering — shows up as a 20-100x median
 * jump on the slice tasks.
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench io-micro
 *   pnpm -F @hoardodile/server bench io-micro --files=1000 --time=1500
 *   pnpm -F @hoardodile/server bench io-micro --check (regression gate vs bench/baselines/io-micro.json)
 *
 * Results are written as JSON to <repo>/tmp/bench/<out>; `--save` also
 * writes the suite baseline. Shared infra lives in ../harness.ts.
 */
import { execFile } from "node:child_process"
import { createReadStream, mkdtempSync, rmSync } from "node:fs"
import { readdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { promisify } from "node:util"
import { createProbeCache, listZipEntries } from "@hoardodile/host"
import { PROBE_HEADER_BYTES, probeImageSource } from "@hoardodile/host/probe"
import sharp from "sharp"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { Bench } from "tinybench"
import {
	type BenchSuiteModule,
	type CommonArgs,
	intArg,
	type SuiteArgs,
} from "../args.ts"
import { buildZipBuffer, roundMb, summarizeBenchTasks } from "../harness.ts"
import {
	type BenchReport,
	extractStoredMetrics,
	machineInfo,
} from "../report.ts"

const requireCjs = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

/** The bundled 7-Zip binary path, or undefined when unavailable. */
function sevenZipBin(): string | undefined {
	const fromEnv = process.env["7Z_BIN_PATH"]
	if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
	try {
		const mod: unknown = requireCjs("@hoardodile/7z-bin")
		return typeof mod === "string" && mod.length > 0 ? mod : undefined
	} catch {
		return undefined
	}
}

type SuiteIoMicroArgs = {
	readonly common: CommonArgs
	readonly files: number
	readonly time: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuiteIoMicroArgs {
	const files = intArg(args, "files")
	const time = intArg(args, "time")
	if (files < 10) throw new Error("--files must be an integer >= 10 (entries)")
	if (time < 100)
		throw new Error("--time must be an integer >= 100 (ms per task)")
	return { common, files, time }
}

type SeededIo = {
	readonly dir: string
	/** The directory listing the read path enumerates per resource. */
	readonly listPath: string
	/** A single file inside the listing for the window-read task. */
	readonly filePath: string
	readonly zipPath: string
	readonly teardown: () => Promise<void>
}

async function seedIo(files: number): Promise<SeededIo> {
	const dir = mkdtempSync(join(tmpdir(), "io-micro-bench-"))
	const byte = Buffer.alloc(8 * 1024, 0xa5)
	for (let k = 0; k < files; k += 1) {
		await writeFile(join(dir, `img-${String(k).padStart(4, "0")}.jpg`), byte)
	}
	const zipPath = join(dir, "sample.zip")
	const entries = Array.from(
		{ length: files },
		(_, k) => [`img-${String(k).padStart(4, "0")}.jpg`, byte] as const,
	)
	await writeFile(zipPath, await buildZipBuffer(entries, false))
	return {
		dir,
		listPath: dir,
		filePath: join(dir, "img-0000.jpg"),
		zipPath,
		teardown: async () => {
			rmSync(dir, { recursive: true, force: true })
		},
	}
}

/**
 * Gaussian-noise PNG sized by side length. Noise is incompressible, so
 * PNG stores ~3 bytes/pixel: 2400×2400 ≈ 17MB (buffer path, under the
 * 32MB stream threshold) and 3700×3700 ≈ 41MB (stream path). Seed-time
 * work, never counted in task samples.
 */
async function generateProbeImage(px: number): Promise<Buffer> {
	return sharp({
		create: {
			width: px,
			height: px,
			channels: 3,
			background: { r: 128, g: 128, b: 128 },
			noise: { type: "gaussian", mean: 128, sigma: 40 },
		},
	})
		.png()
		.toBuffer()
}

export const ioMicroSuite: BenchSuiteModule = {
	name: "io-micro",
	title: "io micro bench",
	flagSpecs: [
		{ name: "files", kind: "int", description: "dir entries", default: 100 },
		{
			name: "time",
			kind: "int",
			description: "ms budget per task",
			default: 800,
		},
	],
	checkDefaults: { time: "600" },
	run: async (rawArgs, common) => {
		const args = resolveArgs(rawArgs, common)
		const machine = machineInfo()
		console.log(
			`files: ${args.files} | time: ${args.time}ms/task | out: ${common.out} | seed: ${common.seed}`,
		)

		const seedStart = performance.now()
		const seeded = await seedIo(args.files)
		const probeSmall = await generateProbeImage(2400)
		const probeLarge = await generateProbeImage(3700)
		console.log(
			`seeded ${args.files}-entry dir in ${((performance.now() - seedStart) / 1000).toFixed(1)}s; probe images ${(probeSmall.length / 1e6).toFixed(1)}MB / ${(probeLarge.length / 1e6).toFixed(1)}MB`,
		)

		const probeCache = createProbeCache()
		const paths = createStoragePaths({ root: join(seeded.dir, "storage") })
		const resId = "aaaaaaaa-1db6-48f5-9d53-1008b8cb84c3"
		await probeCache.getOrCompute("img:v1", async () => ({ width: 1 }))

		const bench = new Bench({ time: args.time })
		bench
			.add("dirListing.entries", async () => {
				await readdir(seeded.listPath, { withFileTypes: true })
			})
			.add("readFileWindow.64KB", async () => {
				for await (const _chunk of createReadStream(seeded.filePath, {
					start: 0,
					end: 64 * 1024,
				})) {
					// drain
				}
			})
			.add("zipEntries.parse", async () => {
				// Nested-container CD parse via yauzl (the only listing
				// engine since the hand-rolled parser was removed).
				await listZipEntries(seeded.zipPath)
			})
		const bin = sevenZipBin()
		if (bin !== undefined) {
			bench.add("sevenZip.list.cold", async () => {
				// Whole-archive listing through a fresh 7-Zip process —
				// the process spawn (~20ms on Windows) dominates.
				await execFileAsync(
					bin,
					["l", "-slt", "-ba", "-sccUTF-8", "-mcp=437", seeded.zipPath],
					{ windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
				)
			})
		}
		bench
			.add("probe.image.stream.41MB", async () => {
				// Fallback path: a bare stream (no readRange) — libvips
				// full-reads non-seekable input, so this is the upper bound.
				await probeImageSource(Readable.from(probeLarge), ".png")
			})
			.add("probe.image.slice.17MB", async () => {
				await probeImageSource(
					{
						openStream: async () => Readable.from(probeSmall),
						readRange: async () => probeSmall.subarray(0, PROBE_HEADER_BYTES),
					},
					".png",
				)
			})
			.add("probe.image.slice.41MB", async () => {
				// Production path: a 256KB header slice is probed as a
				// buffer; the stream fallback only fires when the slice is
				// inconclusive.
				await probeImageSource(
					{
						openStream: async () => Readable.from(probeLarge),
						readRange: async () => probeLarge.subarray(0, PROBE_HEADER_BYTES),
					},
					".png",
				)
			})
			.add("probeCache.hit", async () => {
				await probeCache.getOrCompute("img:v1", async () => ({ width: 1 }))
			})
			.add("probeCache.miss", async () => {
				await probeCache.getOrCompute("img:v2", async () => ({ width: 2 }))
			})
			.add("paths.resource", () => {
				paths.latest.resource(resId)
			})

		await bench.run()

		const metrics = summarizeBenchTasks(bench.tasks)

		const report: BenchReport = {
			schema: 1,
			kind: "io-micro",
			timestamp: new Date().toISOString(),
			config: { files: args.files, time: args.time, seed: common.seed },
			machine,
			caveats: [
				"dirListing.entries measures a readdir withFileTypes over the bare-file resource folder (the production listing path); readFileWindow.64KB drains a 64KB createReadStream window (the production byte-range path).",
				"zipEntries.parse measures the yauzl CD listing on a nested archive — the entry point for reading inside uploaded zip/tar files; sevenZip.list.cold is the whole-archive 7-Zip listing (one cold process spawn per call, ~20ms on Windows) and only exists when the bundled binary is present.",
				"probeCache.hit/miss exercise the promise-valued LRU (miss includes the compute + store); paths.resource includes the assertSafeSegment path authority checks.",
				"probe.image.* feed real >16MB and >32MB noise images. stream.41MB is the no-readRange fallback (libvips full-reads non-seekable input, so it is the upper bound); slice.17MB/slice.41MB are the production header-slice path — a 256KB header slice probed as a buffer. A regression that drops the slice path (or reintroduces whole-entry buffering) shows up as a 20-100x median jump on the slice tasks.",
				"Tinybench runs each task as a hot loop until the --time budget; hot loops amortize syscall/page-cache effects, so this measures per-call CPU cost, not disk latency.",
				"Only same-window paired runs are comparable — the machine shows bimodal load (up to 4x swings).",
			],
			memoryPeakMb: roundMb(process.memoryUsage().rss),
			metrics,
		}
		await seeded.teardown()
		return {
			common,
			report,
			extractMetrics: extractStoredMetrics,
		}
	},
}
