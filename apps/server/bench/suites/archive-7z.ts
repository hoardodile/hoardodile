/**
 * Engine comparison micro-benchmarks (tinybench) for whole-archive work:
 * the same corpus zip listed/extracted/read/packed through yauzl+yazl
 * (pure JS) and through the bundled 7-Zip binary (one process spawn per
 * call). Quantifies the price of the whole-archive 7-Zip switch and the
 * per-op spawn floor — listings, extractions, head reads and STORED
 * packing are the four operations that moved or could move across
 * engines.
 *
 * The 7-Zip tasks are registered only when the bundled binary exists
 * (absent tasks simply drop out of the report).
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench archive-7z
 *   pnpm -F @hoardodile/server bench archive-7z --files=1000 --time=1500
 *   pnpm -F @hoardodile/server bench archive-7z --check (regression gate vs bench/baselines/archive-7z.json)
 *
 * Results are written as JSON to <repo>/tmp/bench/<out>; `--save` also
 * writes the suite baseline. Shared infra lives in ../harness.ts.
 */
import { execFile } from "node:child_process"
import {
	createReadStream,
	createWriteStream,
	mkdtempSync,
	rmSync,
} from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Readable } from "node:stream"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import { listZipEntries } from "@hoardodile/host"
import { streamStoredZip } from "@hoardodile/host/hoard"
import { Bench } from "tinybench"
import yauzl from "yauzl"
import {
	type BenchSuiteModule,
	type CommonArgs,
	intArg,
	type SuiteArgs,
} from "../args.ts"
import {
	buildZipBuffer,
	randomBytes,
	roundMb,
	summarizeBenchTasks,
} from "../harness.ts"
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

type SuiteArchive7zArgs = {
	readonly common: CommonArgs
	readonly files: number
	readonly time: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuiteArchive7zArgs {
	const files = intArg(args, "files")
	const time = intArg(args, "time")
	if (files < 10) throw new Error("--files must be an integer >= 10 (entries)")
	if (time < 100)
		throw new Error("--time must be an integer >= 100 (ms per task)")
	return { common, files, time }
}

type SeededArchive = {
	readonly dir: string
	readonly filesDir: string
	readonly zipPath: string
	/** The first entry name of the corpus zip (deterministic). */
	readonly headName: string
	readonly teardown: () => void
}

async function seedArchive(files: number): Promise<SeededArchive> {
	const dir = mkdtempSync(join(tmpdir(), "archive-7z-bench-"))
	const filesDir = join(dir, "files")
	await mkdir(filesDir, { recursive: true })
	const entries: (readonly [string, Buffer])[] = []
	const data = randomBytes(7, 8 * 1024)
	for (let k = 0; k < files; k += 1) {
		const name = `img-${String(k).padStart(4, "0")}.bin`
		await writeFile(join(filesDir, name), data)
		entries.push([name, data])
	}
	const zipPath = join(dir, "corpus.zip")
	await writeFile(zipPath, await buildZipBuffer(entries, false))
	return {
		dir,
		filesDir,
		zipPath,
		headName: entries[0]![0],
		teardown: () => rmSync(dir, { recursive: true, force: true }),
	}
}

/** Drain a stream into a sink (buffers are discarded). */
function drainStream(stream: NodeJS.ReadableStream): Promise<void> {
	return new Promise<void>((res, rej) => {
		const sink = new Writable({
			write(_chunk, _enc, cb) {
				cb()
			},
		})
		stream.pipe(sink)
		sink.on("finish", res)
		sink.on("error", rej)
		stream.on("error", rej)
	})
}

/** Consume only the first 64KB of an entry stream, then destroy it. */
async function drainHead64K(stream: NodeJS.ReadableStream): Promise<void> {
	let got = 0
	for await (const chunk of stream) {
		got += chunk.length
		if (got >= 64 * 1024) break
	}
	;(stream as Readable).destroy()
}

/** The yauzl fallback extraction shape: list + per-entry stream to disk. */
async function extractWithYauzl(
	zipPath: string,
	destDir: string,
): Promise<void> {
	const zipfile = await new Promise<yauzl.ZipFile>((res, rej) => {
		yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
			if (err !== null && err !== undefined) {
				rej(err)
				return
			}
			res(zip!)
		})
	})
	try {
		for await (const entry of zipfile.eachEntry()) {
			if (entry.fileName.endsWith("/")) continue
			const stream = await new Promise<import("node:stream").Readable>(
				(res, rej) => {
					zipfile.openReadStream(entry, (err, s) => {
						if (err !== null && err !== undefined) {
							rej(err)
							return
						}
						res(s!)
					})
				},
			)
			const target = join(destDir, entry.fileName)
			await mkdir(dirname(target), { recursive: true })
			await pipeline(stream, createWriteStream(target))
		}
	} finally {
		zipfile.close()
	}
}

/** Open a zip file with yauzl and stream one entry by name. */
async function openEntryStreamByName(
	zipPath: string,
	name: string,
): Promise<{
	readonly stream: NodeJS.ReadableStream
	readonly close: () => void
}> {
	const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true })
	for await (const entry of zipfile.eachEntry()) {
		if (entry.fileName !== name) continue
		const stream = await zipfile.openReadStreamPromise(entry)
		return { stream, close: () => zipfile.close() }
	}
	zipfile.close()
	throw new Error(`no entry ${name}`)
}

export const archive7zSuite: BenchSuiteModule = {
	name: "archive-7z",
	title: "archive engine micro bench (yauzl/yazl vs 7-Zip)",
	flagSpecs: [
		{ name: "files", kind: "int", description: "zip entries", default: 500 },
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
		const bin = sevenZipBin()
		console.log(
			`files: ${args.files} | time: ${args.time}ms/task | 7-Zip: ${bin ?? "absent"} | out: ${common.out} | seed: ${common.seed}`,
		)

		const seedStart = performance.now()
		const seeded = await seedArchive(args.files)
		const extractDest = join(seeded.dir, "extract")
		await mkdir(extractDest, { recursive: true })
		console.log(
			`seeded ${args.files}-entry zip in ${((performance.now() - seedStart) / 1000).toFixed(1)}s`,
		)

		const bench = new Bench({ time: args.time })
		bench
			.add("list.yauzl", async () => {
				await listZipEntries(seeded.zipPath)
			})
			.add("extract.yauzl", async () => {
				await extractWithYauzl(seeded.zipPath, extractDest)
			})
			.add("readHead.64KB.yauzl", async () => {
				const { stream, close } = await openEntryStreamByName(
					seeded.zipPath,
					seeded.headName,
				)
				try {
					await drainHead64K(stream)
				} finally {
					close()
				}
			})
			.add("pack.yazl", async () => {
				// The production export shape: on-disk files → STORED zip.
				const pack = streamStoredZip(
					Array.from({ length: args.files }, (_, k) => {
						const name = `img-${String(k).padStart(4, "0")}.bin`
						return {
							name,
							size: 8 * 1024,
							openStream: () => createReadStream(join(seeded.filesDir, name)),
						}
					}),
				)
				await drainStream(pack)
			})
		if (bin !== undefined) {
			bench
				.add("list.sevenZip.cold", async () => {
					await execFileAsync(
						bin,
						["l", "-slt", "-ba", "-sccUTF-8", "-mcp=437", seeded.zipPath],
						{ windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
					)
				})
				.add("extract.sevenZip.cold", async () => {
					await execFileAsync(
						bin,
						["x", seeded.zipPath, `-o${extractDest}`, "-y", "-bd", "-mcp=437"],
						{ windowsHide: true, maxBuffer: 1024 * 1024 },
					)
				})
				.add("readHead.64KB.sevenZip.cold", async () => {
					// 7-Zip cannot seek into an entry: reading a head
					// window costs a spawn + full-entry decompression.
					const { stdout } = await execFileAsync(
						bin,
						["x", seeded.zipPath, seeded.headName, "-so"],
						{ windowsHide: true, maxBuffer: 1024 * 1024 },
					)
					void stdout.slice(0, 64 * 1024)
				})
				.add("pack.sevenZip.cold", async () => {
					const out = join(seeded.dir, "pack.zip")
					await execFileAsync(bin, ["a", "-mx=0", "-tzip", out, "."], {
						cwd: seeded.filesDir,
						windowsHide: true,
						maxBuffer: 1024 * 1024,
					})
				})
		}

		await bench.run()

		const metrics = summarizeBenchTasks(bench.tasks)

		const report: BenchReport = {
			schema: 1,
			kind: "archive-7z",
			timestamp: new Date().toISOString(),
			config: { files: args.files, time: args.time, seed: common.seed },
			machine,
			caveats: [
				"Each pair compares the same corpus zip (STORED 8KB entries, yazl-built). list.yauzl is the production nested listing; list.sevenZip.cold spawns a fresh 7-Zip per call (the ~20ms Windows spawn floor dominates).",
				"extract.yauzl is the no-binary fallback shape (yauzl streams per entry); extract.sevenZip.cold is the production path (one `7z x` over the whole archive).",
				"readHead.64KB.yauzl opens one entry stream and reads a 64KB window (the thumbnail/source-view path); readHead.64KB.sevenZip.cold decompresses the whole entry to stdout because 7-Zip has no byte-range access.",
				"pack.yazl streams STORED zip entries without a staging file (the export path); pack.sevenZip.cold writes `7z a -mx=0` output to disk.",
				"7-Zip tasks are registered only when the bundled binary exists; runs without the binary simply lack them.",
				"Tinybench runs each task as a hot loop until the --time budget; cold spawns dominate the 7-Zip medians, syscall/page-cache effects are amortized for the JS tasks.",
				"Only same-window paired runs are comparable — the machine shows bimodal load (up to 4x swings).",
			],
			memoryPeakMb: roundMb(process.memoryUsage().rss),
			metrics,
		}
		seeded.teardown()
		return {
			common,
			report,
			extractMetrics: extractStoredMetrics,
		}
	},
}
