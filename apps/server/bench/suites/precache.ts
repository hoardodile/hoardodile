/**
 * Backend benchmark for the "preview rebuild after cache clear" (precache)
 * pipeline. Mirrors the production flow in `src/domain/precache/precache.ts`
 * (`runPrecache`) without the HTTP/SSE layer:
 *
 *   per resource: rebuildResourceFully (meta units + cover render + coverMeta)
 *   per character: getVariantVersion + getCharacterThumb (avatar, fullbody)
 *
 * Same paging (200/page), same adaptive concurrency
 * (`max: cpus, initial: cpus - 1`), same cache-clear ritual
 * (rm local/cache + clearAllMeta() + clearAllImageMeta()).
 *
 * COMPARISON RULE: this machine shows bimodal load (up to 4x run-to-run
 * swings from external processes). Never compare runs from different time
 * windows — always run the configurations you compare back-to-back in one
 * sitting (paired runs) and prefer the median of `--repeat`.
 *
 * Plugin modes (`--plugins=`):
 *   stub (default) — bench-local in-process file-contract plugin (see
 *     harness.ts createFileStubHooks): real sharp/zip probing, no
 *     worker-sandbox RPC. The stub ships a `coverLocal` (first media
 *     entry by natural sort) so the cover render pipeline is exercised —
 *     the builtin file plugin itself has no coverLocal, so real mode
 *     measures the file-only world where covers resolve unavailable.
 *   real — production plugin wiring: sandbox worker + loader (builtin
 *     plugin-file, plus `--plugin=<dist-dir>` for an external content
 *     plugin that may add coverLocal). Isolates RPC cost. The builtin
 *     file plugin must be built; the bench errors with a hint otherwise.
 *
 * Video corpus (`--video-ratio=0.15`): that fraction of resources gets a
 * synthetic ffmpeg-generated video (testsrc2/mandelbrot, 2-30s, 480p-4K,
 * a few >50MB files) as its first zip entry, so the cover source picks
 * it. 0 (default) disables videos.
 *
 * Large-image corpus (`--large-image-ratio=0.15`): that fraction of
 * resources gets a ~38MB noise PNG (past the 32MB streaming threshold)
 * as its first zip entry, so cover probing AND cover rendering go
 * through the stream path (header-only probe, piped sharp input). The
 * `resources.largeCoverUnavailableRate` metric gates the render
 * correctness — if the stream path ever breaks again, the ready rate
 * collapses and `--check` fails. 0 disables large images.
 *
 * Repeats (`--repeat=N`, default 3): each tier is seeded ONCE, then the
 * cache-clear + sweep ritual runs N times on the same corpus; the report
 * carries every rep plus median/min/max per metric. Host-side caches
 * (probe cache, zip CD cache) persist across reps of a tier — rep 1 is
 * the cold rep; paired configurations get identical treatment.
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench precache
 *   pnpm -F @hoardodile/server bench precache --tiers=50 --plugins=real --repeat=3
 *   pnpm -F @hoardodile/server bench precache --tiers=50,200 --video-ratio=0.15 --out=v.json
 *   pnpm -F @hoardodile/server bench precache --plugins=real --plugin=../my-plugin/dist
 *   pnpm -F @hoardodile/server bench precache --check (regression gate vs bench/baselines/precache.json)
 *
 * `--chars=0` (default) picks a per-tier character count of max(5, tier/5).
 * Results are written as JSON to <repo>/tmp/bench/<out>; `--save` also
 * writes the suite baseline. Shared infra lives in harness.ts.
 */
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os, { tmpdir } from "node:os"
import { join } from "node:path"
import { type FfmpegPaths, resolveFfmpegPaths } from "@hoardodile/host/render"
import sharp from "sharp"
import { createCharacterService } from "src/domain/char/service.ts"
import { createResourceService } from "src/domain/res/service.ts"
import { seedResourceArtifact } from "src/domain/res/test-seed.ts"
import { createAdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import { openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { createThumbService } from "src/infra/thumb/service.ts"
import {
	type BenchSuiteModule,
	type CommonArgs,
	intArg,
	intListArg,
	numberArg,
	type SuiteArgs,
} from "../args.ts"
import {
	assertRealPluginDists,
	type countHooks,
	fmtMetric,
	fmtMs,
	type HookSnapshot,
	type HooksFactory,
	hooksFactoryFor,
	type MetricSummary,
	maxPhaseMemory,
	metricFromSummary,
	mulberry32,
	type PhaseResult,
	runPhase,
	runReps,
	summarizeMetric,
	summarizeSamples,
} from "../harness.ts"
import { type BenchMetric, type BenchReport, machineInfo } from "../report.ts"

const PAGE_SIZE = 200

type SuitePrecacheArgs = {
	readonly common: CommonArgs
	readonly tiers: readonly number[]
	readonly chars: number
	readonly videoRatio: number
	readonly largeImageRatio: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuitePrecacheArgs {
	const tiers = intListArg(args, "tiers")
	const chars = intArg(args, "chars")
	const videoRatio = numberArg(args, "video-ratio")
	if (videoRatio < 0 || videoRatio > 1) {
		throw new Error("--video-ratio must be a number between 0 and 1")
	}
	const largeImageRatio = numberArg(args, "large-image-ratio")
	if (largeImageRatio < 0 || largeImageRatio > 1) {
		throw new Error("--large-image-ratio must be a number between 0 and 1")
	}
	return { common, tiers, chars, videoRatio, largeImageRatio }
}

async function generateImage(
	rand: () => number,
	width: number,
	height: number,
	format: "png" | "jpeg",
): Promise<Buffer> {
	// Gaussian noise keeps the encoders honest (incompressible content);
	// a random tint varies color so chroma paths do real work too.
	const tint = {
		r: 64 + Math.floor(rand() * 160),
		g: 64 + Math.floor(rand() * 160),
		b: 64 + Math.floor(rand() * 160),
	}
	let img = sharp({
		create: {
			width,
			height,
			channels: 3,
			// Required by sharp's types; ignored when `noise` is set.
			background: { r: 128, g: 128, b: 128 },
			noise: {
				type: "gaussian",
				mean: 100 + Math.floor(rand() * 80),
				sigma: 20 + Math.floor(rand() * 50),
			},
		},
	}).tint(tint)
	img = format === "png" ? img.png() : img.jpeg({ quality: 80 })
	return img.toBuffer()
}

function randomDims(rand: () => number): { width: number; height: number } {
	return {
		width: 400 + Math.floor(rand() * 2600),
		height: 600 + Math.floor(rand() * 3400),
	}
}

/**
 * A ~12.6MP gaussian-noise PNG. Noise is incompressible; `compressionLevel:
 * 0` stores it raw at ~3 bytes/pixel, so the output lands around 38MB —
 * reliably past the 32MB streaming threshold in the thumb pipeline, and
 * faster to generate than a compressed encode. Exercises the stream
 * probe/render path (header-only probe, piped sharp input).
 */
function generateLargeImage(rand: () => number): Promise<Buffer> {
	return sharp({
		create: {
			width: 4200,
			height: 3000,
			channels: 3,
			// Required by sharp's types; ignored when `noise` is set.
			background: { r: 128, g: 128, b: 128 },
			noise: {
				type: "gaussian",
				mean: 100 + Math.floor(rand() * 80),
				sigma: 20 + Math.floor(rand() * 50),
			},
		},
	})
		.png({ compressionLevel: 0 })
		.toBuffer()
}

// ── Video corpus generation ─────────────────────────────────────────────

type VideoSpec = {
	readonly width: number
	readonly height: number
	readonly durationSec: number
	readonly source: "testsrc2" | "mandelbrot"
	/** Constant bitrate; used for the few deliberately large files. */
	readonly bitrate?: string
}

const VIDEO_SIZES: readonly (readonly [number, number])[] = [
	[854, 480],
	[1280, 720],
	[1920, 1080],
]

/**
 * Deterministic video spec for the n-th video resource. Every 5th video
 * is a deliberately large 4K file (>50MB) to exercise the
 * materialize-to-disk path in the video cover pipeline.
 */
function videoSpecFor(videoIndex: number, rand: () => number): VideoSpec {
	const large = videoIndex % 5 === 4
	if (large) {
		return {
			width: 3840,
			height: 2160,
			durationSec: 25,
			source: videoIndex % 2 === 0 ? "testsrc2" : "mandelbrot",
			// ~78MB at 25s — past the 50MB materialization threshold class.
			bitrate: "25M",
		}
	}
	const size = VIDEO_SIZES[Math.floor(rand() * VIDEO_SIZES.length)] ?? [
		854, 480,
	]
	return {
		width: size[0] ?? 854,
		height: size[1] ?? 480,
		durationSec: 2 + Math.floor(rand() * 29),
		source: videoIndex % 2 === 0 ? "testsrc2" : "mandelbrot",
	}
}

/**
 * Generate a synthetic video with the bundled ffmpeg. Generation spawns
 * are seed-time work and never counted in the precache phase counters.
 */
async function generateVideo(
	ffmpeg: FfmpegPaths,
	spec: VideoSpec,
	destPath: string,
): Promise<Buffer> {
	const args = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		`${spec.source}=size=${spec.width}x${spec.height}:rate=30`,
		"-t",
		String(spec.durationSec),
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-pix_fmt",
		"yuv420p",
	]
	if (spec.bitrate !== undefined) args.push("-b:v", spec.bitrate)
	args.push(destPath)
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(ffmpeg.ffmpeg, args, {
			stdio: ["ignore", "ignore", "pipe"],
		})
		const stderrChunks: Buffer[] = []
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
		child.on("error", rejectPromise)
		child.on("close", (code) => {
			if (code === 0) {
				resolvePromise()
			} else {
				rejectPromise(
					new Error(
						`ffmpeg video gen exited ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`,
					),
				)
			}
		})
	})
	return readFile(destPath)
}

// ── Counters ────────────────────────────────────────────────────────────

type CoverCounter = {
	renders: number
	ready: number
	unavailable: number
	videoRenders: number
	videoReady: number
	videoGetCoverMs: number
	imageGetCoverMs: number
	videoItemMs: number[]
	imageItemMs: number[]
	/** >32MB image covers (stream-path renders). */
	largeRenders: number
	largeReady: number
}

function createCoverCounter(): CoverCounter {
	return {
		renders: 0,
		ready: 0,
		unavailable: 0,
		videoRenders: 0,
		videoReady: 0,
		videoGetCoverMs: 0,
		imageGetCoverMs: 0,
		videoItemMs: [],
		imageItemMs: [],
		largeRenders: 0,
		largeReady: 0,
	}
}

/** Bytes materialized by the video pipeline into `extracted/v<ver>/`. */
async function extractedBytes(root: string): Promise<number> {
	const resRoot = join(root, "local", "cache", "resources")
	const ids = await readdir(resRoot, { withFileTypes: true }).catch(() => [])
	let total = 0
	for (const entry of ids) {
		if (entry.isDirectory()) {
			total += await dirBytes(join(resRoot, entry.name, "extracted"))
		}
	}
	return total
}

// ── Corpus seeding ──────────────────────────────────────────────────────

type CorpusStats = {
	resources: number
	characters: number
	files: number
	bytes: number
	videos: number
	largeImages: number
	seedMs: number
}

type SeededCorpus = {
	readonly root: string
	readonly res: ReturnType<typeof createResourceService>
	readonly chars: ReturnType<typeof createCharacterService>
	readonly thumbs: ReturnType<typeof createThumbService>
	readonly corpus: CorpusStats
	/** Ids of resources whose cover source is a video entry. */
	readonly videoResIds: ReadonlySet<string>
	/** Ids of resources whose cover source is a >32MB image entry. */
	readonly largeImageResIds: ReadonlySet<string>
	readonly teardown: () => Promise<void>
}

async function seedCorpus(
	tier: number,
	charCount: number,
	seed: number,
	hooksFactory: HooksFactory,
	videoRatio: number,
	largeImageRatio: number,
	ffmpeg: FfmpegPaths,
): Promise<SeededCorpus> {
	const rand = mulberry32(seed)
	const root = mkdtempSync(join(tmpdir(), `precache-bench-${tier}-`))
	const dbh = openDb(":memory:")
	dbh.runMigrations()
	const paths = createStoragePaths({ root })
	const { hooks, contentPluginId, teardown } = await hooksFactory({
		db: dbh.db,
		paths,
	})
	const res = createResourceService({
		db: dbh.db,
		paths,
		pluginHooks: hooks,
		readOnly: { current: false },
	})
	const chars = createCharacterService({
		db: dbh.db,
		paths,
		readOnly: { current: false },
	})
	// Mirror prod (src/infra/thumb/plugin.ts): adaptive concurrency, defaults.
	const thumbs = createThumbService({
		paths,
		resources: res,
		concurrency: createAdaptiveConcurrency(),
	})

	const seedStart = performance.now()
	const corpus: CorpusStats = {
		resources: tier,
		characters: charCount,
		files: 0,
		bytes: 0,
		videos: 0,
		largeImages: 0,
		seedMs: 0,
	}
	const videoResIds = new Set<string>()
	const largeImageResIds = new Set<string>()
	const seedTmp = join(root, "seed-tmp")
	await mkdir(seedTmp, { recursive: true })
	const videoEvery = videoRatio > 0 ? Math.round(1 / videoRatio) : 0
	const largeImageEvery =
		largeImageRatio > 0 ? Math.round(1 / largeImageRatio) : 0

	for (let i = 0; i < tier; i++) {
		const large = i % 10 === 9
		const fileCount = large
			? 20 + Math.floor(rand() * 5)
			: 3 + Math.floor(rand() * 6)
		const files: { name: string; bytes: Buffer }[] = []
		const withVideo = videoEvery > 0 && i % videoEvery === 0
		if (withVideo) {
			const spec = videoSpecFor(corpus.videos, rand)
			const videoPath = join(seedTmp, `video-${corpus.videos}.mp4`)
			const bytes = await generateVideo(ffmpeg, spec, videoPath)
			// Sorts first in natural order, so the stub's coverLocal picks
			// the video as the cover source.
			files.push({ name: "000-cover.mp4", bytes })
			corpus.videos++
			console.log(
				`    generated video ${spec.width}x${spec.height} ${spec.durationSec}s (${(bytes.length / 1e6).toFixed(1)} MB)`,
			)
		}
		const withLarge = largeImageEvery > 0 && i % largeImageEvery === 0
		if (withLarge) {
			// Sorts first in natural order (same prefix as the video, which
			// still wins the cover slot when both are present) — the cover
			// probe and render both go through the stream path.
			const bytes = await generateLargeImage(rand)
			files.push({ name: "000-cover-large.png", bytes })
			corpus.largeImages++
			console.log(
				`    generated large image ${(bytes.length / 1e6).toFixed(1)} MB (>32MB stream path)`,
			)
		}
		for (let k = 0; k < fileCount; k++) {
			const { width, height } = randomDims(rand)
			const format =
				width * height > 1_500_000 ? "jpeg" : rand() < 0.5 ? "png" : "jpeg"
			const bytes = await generateImage(rand, width, height, format)
			files.push({
				name: `img-${String(k).padStart(3, "0")}.${format === "png" ? "png" : "jpg"}`,
				bytes,
			})
		}
		const r = await res.create({ name: `bench-res-${i}` })
		if (withVideo) videoResIds.add(r.id)
		if (withLarge) largeImageResIds.add(r.id)
		await seedResourceArtifact({ db: dbh, paths }, r.id, files)
		await res.setContentPluginId(r.id, contentPluginId)
		// Drain the async meta rebuilds enqueued by setContentPluginId so the
		// seeded state is settled before the cache-clear wipes it.
		await res.rebuildAllMeta(r.id)
		corpus.files += files.length
		corpus.bytes += files.reduce((acc, f) => acc + f.bytes.length, 0)
		if ((i + 1) % 25 === 0) {
			console.log(`    seeded ${i + 1}/${tier} resources`)
		}
	}
	await res.drainMetaQueue()

	for (let i = 0; i < charCount; i++) {
		const c = await chars.create({ name: `bench-char-${i}` })
		const avatarPath = join(seedTmp, `avatar-${i}.jpg`)
		await writeFile(
			avatarPath,
			await generateImage(
				rand,
				700 + Math.floor(rand() * 400),
				900 + Math.floor(rand() * 500),
				"jpeg",
			),
		)
		await chars.setImage(c.id, "avatar", ".jpg", avatarPath)
		if (i % 2 === 0) {
			const fullbodyPath = join(seedTmp, `fullbody-${i}.jpg`)
			await writeFile(
				fullbodyPath,
				await generateImage(
					rand,
					1400 + Math.floor(rand() * 600),
					2000 + Math.floor(rand() * 800),
					"jpeg",
				),
			)
			await chars.setImage(c.id, "fullbody", ".jpg", fullbodyPath)
		}
	}
	await rm(seedTmp, { recursive: true, force: true })
	corpus.seedMs = performance.now() - seedStart

	return {
		root,
		res,
		chars,
		thumbs,
		corpus,
		videoResIds,
		largeImageResIds,
		teardown,
	}
}

// ── Repeat reps over one seeded corpus ──────────────────────────────────

type RepResult = {
	readonly resources: PhaseResult
	readonly characters: PhaseResult
	readonly coverHit: PhaseResult
	readonly thumbBytes: number
	readonly counters: {
		readonly hooks?: HookSnapshot
		readonly covers: Omit<CoverCounter, "videoItemMs" | "imageItemMs">
		readonly videoItemMs: ReturnType<typeof summarizeSamples>
		readonly imageItemMs: ReturnType<typeof summarizeSamples>
		readonly materializedBytes: number
	}
}

async function runRep(
	seeded: SeededCorpus,
	hookCounter: ReturnType<typeof countHooks> | undefined,
): Promise<RepResult> {
	const { root, res, chars, thumbs, videoResIds, largeImageResIds } = seeded

	// Mirror DELETE /api/cache: wipe local/cache + rebuildable meta.
	await rm(join(root, "local", "cache"), {
		recursive: true,
		force: true,
	}).catch(() => {})
	res.clearAllMeta()
	chars.clearAllImageMeta()
	hookCounter?.reset()
	const covers = createCoverCounter()

	// Mirror doWork(): same adaptive concurrency parameters.
	const concurrency = createAdaptiveConcurrency({
		max: os.cpus().length,
		initial: Math.max(1, os.cpus().length - 1),
	})

	const resources = await runPhase(
		(page) => res.list({ page, size: PAGE_SIZE }),
		async (r, timed) => {
			// Single-pass per-resource pipeline (prod: domain/precache calls
			// exactly this via res.rebuildResourceFully).
			const itemStart = performance.now()
			await timed("rebuildResourceFully", () =>
				res.rebuildResourceFully(r.id, async (id) => {
					const isVideo = videoResIds.has(id)
					const isLarge = largeImageResIds.has(id)
					covers.renders++
					if (isVideo) covers.videoRenders++
					if (isLarge) covers.largeRenders++
					const t0 = performance.now()
					const cover = await thumbs.getCover(id)
					const ms = performance.now() - t0
					if (isVideo) covers.videoGetCoverMs += ms
					else covers.imageGetCoverMs += ms
					if (cover.kind === "ready") {
						covers.ready++
						if (isVideo) covers.videoReady++
						if (isLarge) covers.largeReady++
					} else {
						covers.unavailable++
					}
					return cover
				}),
			)
			const itemMs = performance.now() - itemStart
			if (videoResIds.has(r.id)) covers.videoItemMs.push(itemMs)
			else covers.imageItemMs.push(itemMs)
		},
		concurrency,
		"resources",
	)

	const characters = await runPhase(
		(page) => chars.list({ page, size: PAGE_SIZE }),
		async (c, timed) => {
			for (const variant of ["avatar", "fullbody"] as const) {
				let ver = 0
				await timed("getVariantVersion", async () => {
					ver = await chars.getVariantVersion(c.id, variant)
				})
				await timed("getCharacterThumb", () =>
					thumbs.getCharacterThumb(c.id, variant, ver),
				)
			}
		},
		concurrency,
		"characters",
	)

	// Steady-state cover request: findCover (resource-dir readdir, cached
	// in-process after the first call) + getCover on the rendered cover
	// (two stat checks for the on-disk variants). Rep 1 pays the readdirs;
	// later reps measure the cached path. On Windows, the first stat of a
	// freshly rendered cover pays antivirus scan latency — an environment
	// artifact, not app cost.
	const coverHit = await runPhase(
		(page) => res.list({ page, size: PAGE_SIZE }),
		async (r, timed) => {
			const coverPath = await timed("findCover", () => res.findCover(r.id))
			await timed("getCover", () => thumbs.getCover(r.id, coverPath))
		},
		concurrency,
		"coverHit",
	)

	// Drain the background meta queues the sweep's list() calls filled, so
	// leftover rebuilds neither leak into the next rep nor race teardown.
	// The drain is deliberately outside the phase walls — production
	// precache also reports done while the queues settle.
	await res.drainMetaQueue()

	// Total on-disk size of every rendered thumb — the size side of the
	// encoder effort/quality tradeoff (D2 acceptance criterion). The
	// video pipeline's materialized sources (extracted/) live under the
	// same tree and are reported separately, not as thumb output.
	const materializedBytes = await extractedBytes(root)
	const thumbBytes =
		(await dirBytes(join(root, "local", "cache", "resources"))) +
		(await dirBytes(join(root, "local", "cache", "characters"))) -
		materializedBytes

	const { videoItemMs, imageItemMs, ...coverCounts } = covers
	return {
		resources,
		characters,
		coverHit,
		thumbBytes,
		counters: {
			hooks: hookCounter?.snapshot(),
			covers: coverCounts,
			videoItemMs: summarizeSamples(videoItemMs),
			imageItemMs: summarizeSamples(imageItemMs),
			materializedBytes,
		},
	}
}

// ── Tier driver + reporting ─────────────────────────────────────────────

type TierResult = {
	readonly tier: number
	readonly charCount: number
	readonly corpus: CorpusStats
	readonly reps: readonly RepResult[]
	readonly summary: {
		readonly resources: {
			readonly wallMs: MetricSummary
			readonly itemsPerSec: MetricSummary
			readonly perItemMeanMs: MetricSummary
		}
		readonly characters: {
			readonly wallMs: MetricSummary
			readonly itemsPerSec: MetricSummary
		}
		readonly coverHit: {
			readonly wallMs: MetricSummary
			readonly perItemMeanMs: MetricSummary
		}
	}
}

async function benchTier(
	tier: number,
	charCount: number,
	args: SuitePrecacheArgs,
	ffmpeg: FfmpegPaths,
): Promise<TierResult> {
	console.log(`\n=== tier ${tier} (${charCount} characters) — seeding ===`)
	// Real mode: wrap the hooks with invoke counters (the RPC proxy)
	// before the services are constructed, so every phase call is counted.
	const wiring = hooksFactoryFor(args.common, { wrap: "count" })
	const seeded = await seedCorpus(
		tier,
		charCount,
		args.common.seed + tier,
		wiring.factory,
		args.videoRatio,
		args.largeImageRatio,
		ffmpeg,
	)
	console.log(
		`    corpus: ${seeded.corpus.files} files (${seeded.corpus.videos} videos, ${seeded.corpus.largeImages} large images), ${(seeded.corpus.bytes / 1e9).toFixed(2)} GB, seeded in ${(seeded.corpus.seedMs / 1000).toFixed(1)}s`,
	)

	const hookCounter = wiring.counter()
	const reps = await runReps(seeded, `tier ${tier}`, args.common.repeat, () =>
		runRep(seeded, hookCounter),
	)

	return {
		tier,
		charCount,
		corpus: seeded.corpus,
		reps,
		summary: {
			resources: {
				wallMs: summarizeMetric(reps.map((r) => r.resources.wallMs)),
				itemsPerSec: summarizeMetric(reps.map((r) => r.resources.itemsPerSec)),
				perItemMeanMs: summarizeMetric(
					reps.map((r) => r.resources.perItemMs.mean),
				),
			},
			characters: {
				wallMs: summarizeMetric(reps.map((r) => r.characters.wallMs)),
				itemsPerSec: summarizeMetric(reps.map((r) => r.characters.itemsPerSec)),
			},
			coverHit: {
				wallMs: summarizeMetric(reps.map((r) => r.coverHit.wallMs)),
				perItemMeanMs: summarizeMetric(
					reps.map((r) => r.coverHit.perItemMs.mean),
				),
			},
		},
	}
}

async function dirBytes(dir: string): Promise<number> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
	let total = 0
	for (const entry of entries) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			total += await dirBytes(full)
		} else if (entry.isFile()) {
			const info = await stat(full).catch(() => undefined)
			total += info?.size ?? 0
		}
	}
	return total
}

function printTier(result: TierResult): void {
	const { summary, reps, corpus } = result
	const medianRep = reps[Math.floor(reps.length / 2)] ?? reps[0]
	console.log(
		`  resources: wall ${fmtMetric(summary.resources.wallMs, "ms")} | ${fmtMetric(summary.resources.itemsPerSec, "/s")}`,
	)
	console.log(
		`    per-item mean ${fmtMetric(summary.resources.perItemMeanMs, "ms")}`,
	)
	console.log(
		`  characters: wall ${fmtMetric(summary.characters.wallMs, "ms")} | ${fmtMetric(summary.characters.itemsPerSec, "/s")}`,
	)
	console.log(
		`  coverHit: wall ${fmtMetric(summary.coverHit.wallMs, "ms")} | item mean ${fmtMetric(summary.coverHit.perItemMeanMs, "ms")}`,
	)
	if (medianRep !== undefined) {
		console.log(
			`  median rep covers: ${medianRep.counters.covers.ready}/${medianRep.counters.covers.renders} ready, ${medianRep.counters.covers.unavailable} unavailable | materialized ${(medianRep.counters.materializedBytes / 1e6).toFixed(1)} MB | thumbs ${(medianRep.thumbBytes / 1e6).toFixed(1)} MB`,
		)
		if (medianRep.counters.covers.largeRenders > 0) {
			const rate =
				medianRep.counters.covers.largeReady /
				medianRep.counters.covers.largeRenders
			console.log(
				`    large-image covers: ${medianRep.counters.covers.largeReady}/${medianRep.counters.covers.largeRenders} ready (${(rate * 100).toFixed(0)}% — stream path)`,
			)
		}
		if (corpus.videos > 0) {
			console.log(
				`    video items: mean ${fmtMs(medianRep.counters.videoItemMs.mean)} vs image items ${fmtMs(medianRep.counters.imageItemMs.mean)} | video getCover ${fmtMs(medianRep.counters.covers.videoGetCoverMs)} vs image ${fmtMs(medianRep.counters.covers.imageGetCoverMs)} aggregate`,
			)
		}
		if (medianRep.counters.hooks !== undefined) {
			console.log(
				`    hooks: ${medianRep.counters.hooks.totalCalls} invokes, ${fmtMs(medianRep.counters.hooks.totalMs)} aggregate`,
			)
			const entries = Object.entries(medianRep.counters.hooks.byMethod).sort(
				(a, b) => b[1].ms - a[1].ms,
			)
			for (const [method, stats] of entries) {
				console.log(`      ${method}: ${stats.calls} calls, ${fmtMs(stats.ms)}`)
			}
		}
	}
	const failed = reps.reduce((acc, r) => acc + r.resources.failed, 0)
	if (failed > 0) console.log(`  FAILURES across reps: ${failed}`)
}

// Regression metrics: wall + throughput of the largest tier, the
// large-image cover availability (correctness of the >32MB stream path),
// and the sweep's peak memory.
export function extractPrecacheMetrics(report: BenchReport): BenchMetric[] {
	const tiers = (report.tiers ?? []) as readonly TierResult[]
	const last = tiers[tiers.length - 1]
	if (last === undefined) return []
	const s = last.summary
	const largeUnavailable = summarizeMetric(
		last.reps.map((r) => {
			const { largeRenders, largeReady } = r.counters.covers
			return largeRenders > 0 ? (largeRenders - largeReady) / largeRenders : 0
		}),
	)
	return [
		metricFromSummary("resources.wallMs", "ms", s.resources.wallMs),
		metricFromSummary("resources.itemsPerSec", "/s", s.resources.itemsPerSec),
		metricFromSummary(
			"resources.perItemMeanMs",
			"ms",
			s.resources.perItemMeanMs,
		),
		metricFromSummary("characters.wallMs", "ms", s.characters.wallMs),
		metricFromSummary("characters.itemsPerSec", "/s", s.characters.itemsPerSec),
		metricFromSummary("coverHit.perItemMeanMs", "ms", s.coverHit.perItemMeanMs),
		// Failure-rate formulation on purpose: the gate is "fresh median
		// exceeds baseline × 1.25", so a readiness metric that collapses
		// to zero would never trip — an unavailable rate that rises to
		// 100% does.
		metricFromSummary(
			"resources.largeCoverUnavailableRate",
			"rate",
			largeUnavailable,
		),
		metricFromSummary("memoryPeakMb", "MB", {
			median: report.memoryPeakMb,
			min: report.memoryPeakMb,
			max: report.memoryPeakMb,
		}),
	]
}

function maxTierPhaseMemory(tiers: readonly TierResult[]): number {
	const phases = tiers.flatMap((t) =>
		t.reps.flatMap((r) => [r.resources, r.characters, r.coverHit]),
	)
	return maxPhaseMemory(phases)
}

export const precacheSuite: BenchSuiteModule = {
	name: "precache",
	title: "precache bench",
	flagSpecs: [
		{
			name: "tiers",
			kind: "intList",
			description: "resource counts per tier",
			default: [50, 200],
		},
		{
			name: "chars",
			kind: "int",
			description: "characters per tier (0 = max(5, tier/5))",
			default: 0,
		},
		{
			name: "video-ratio",
			kind: "number",
			description: "fraction of resources with a video cover source",
			default: 0,
		},
		{
			name: "large-image-ratio",
			kind: "number",
			description:
				"fraction of resources with a >32MB image cover source (stream path)",
			default: 0.15,
		},
	],
	checkDefaults: {
		tiers: "20",
		repeat: "2",
		"large-image-ratio": "0.15",
	},
	run: async (rawArgs, common) => {
		const args = resolveArgs(rawArgs, common)
		assertRealPluginDists(common)
		const ffmpeg = resolveFfmpegPaths()
		const machine = machineInfo()
		console.log(
			`tiers: ${args.tiers.join(", ")} | plugins: ${common.plugins}${common.plugin !== undefined ? ` + ${common.plugin}` : ""} | video-ratio: ${args.videoRatio} | large-image-ratio: ${args.largeImageRatio} | repeat: ${common.repeat} | out: ${common.out} | seed: ${common.seed}`,
		)

		const tiers: TierResult[] = []
		for (const tier of args.tiers) {
			const charCount =
				args.chars > 0 ? args.chars : Math.max(5, Math.round(tier / 5))
			const result = await benchTier(tier, charCount, args, ffmpeg)
			tiers.push(result)
			console.log(
				`\n--- tier ${tier} summary (median [min–max] of ${common.repeat}) ---`,
			)
			printTier(result)
		}

		const report: BenchReport = {
			schema: 1,
			kind: "precache",
			timestamp: new Date().toISOString(),
			config: {
				plugins: common.plugins,
				plugin: undefined,
				videoRatio: args.videoRatio,
				largeImageRatio: args.largeImageRatio,
				repeat: common.repeat,
				seed: common.seed,
			},
			machine,
			caveats: [
				"Only same-window paired runs are comparable — the machine shows bimodal load (up to 4x swings).",
				"Step/hook aggregates are wall-time sums across concurrent items; they exceed phase wall time in proportion to parallelism.",
				"Hook invoke counts are the RPC proxy: 1 worker message round-trip per invoke, plus 2 per ResourceAPI call made inside the worker.",
				"ffmpeg spawn count for video covers ≈ video coverRenders (+1 retry each when materialization kicked in); ffprobe spawns ≈ cover unavailables (probe fallback).",
				"Large-image resources (--large-image-ratio) cover-probe and render through the stream path (>32MB entries): a broken stream probe/render shows up as resources.largeCoverUnavailableRate ≈ 1 and a perItemMean jump.",
				"Real mode seeds resources against the registered plugin (builtin file plugin, or the --plugin dev plugin): runMetaHooks (sourceMeta) and resolveLocalCoverSource invoke the sandboxed hooks; with the file plugin covers resolve unavailable (no coverLocal) — the cover render pipeline is exercised in stub mode (file-contract stub + coverLocal). Pass --plugin=<dist> to bench a cover-capable plugin.",
				"Each tier is seeded once; reps share host-side caches (probe cache, zip CD cache) — rep 1 is the cold rep, all paired configurations get identical treatment.",
				"Production-faithful duplication: the sweep's list() enqueues background missing-meta rebuilds while each item is also rebuilt directly — hook invoke counts are ~2x the resource count by design. Queues are drained after each rep so work never leaks across reps.",
				"memoryPeakMb is the max RSS observed across phases/reps — noisy on bimodal machines; treat it as a coarse memory-regression signal.",
			],
			memoryPeakMb: maxTierPhaseMemory(tiers),
			tiers,
		}
		return { common, report, extractMetrics: extractPrecacheMetrics }
	},
}
