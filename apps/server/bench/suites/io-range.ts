/**
 * io-range — range-serving micro-benchmarks for the bare-file read path.
 *
 * The tasks prove (and regression-gate) that serving a byte range of a
 * literal resource file reads only the window:
 *   - `range.discard.*` drains the whole file from position 0 through
 *     `sliceStream` and discards the prefix — the historical serving
 *     path, whose cost grows linearly with the requested offset;
 *   - `range.window.*` reads the same range through a
 *     `createReadStream(path, {start, end})` window — the fixed path,
 *     flat regardless of offset.
 * A video seek to 90% of a large file is the difference between reading
 * 90% of the file and reading the requested megabyte.
 *
 * The remaining tasks pin the other hot micro-costs of the read path:
 * `open.*` (path-walk + open + fstat vs stat + open), `bulk.*`
 * (upfront stream opens before the first byte vs size-first packing),
 * `listEntries.*` (guarded memo hit vs full walk + sort) and
 * `virtual.range.64KB` (inner page of a cached-CD archive).
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench io-range
 *   pnpm -F @hoardodile/server bench io-range --mib=256 --time=1500
 *   pnpm -F @hoardodile/server bench io-range --check
 *
 * Results are written as JSON to <repo>/tmp/bench/<out>; `--save` also
 * writes the suite baseline. Shared infra lives in ../harness.ts.
 */

import { randomBytes, randomFillSync } from "node:crypto"
import { createReadStream, mkdtempSync, rmSync } from "node:fs"
import { open, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	createDirectoryContainer,
	createNestedAwareContainer,
} from "@hoardodile/host"
import { sliceStream } from "src/infra/http/byte-range.ts"
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

type SuiteIoRangeArgs = {
	readonly common: CommonArgs
	readonly mib: number
	readonly files: number
	readonly pages: number
	readonly time: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuiteIoRangeArgs {
	const mib = intArg(args, "mib")
	const files = intArg(args, "files")
	const pages = intArg(args, "pages")
	const time = intArg(args, "time")
	if (mib < 8) throw new Error("--mib must be an integer >= 8 (file size)")
	if (files < 10) throw new Error("--files must be an integer >= 10")
	if (pages < 10) throw new Error("--pages must be an integer >= 10")
	if (time < 100) throw new Error("--time must be an integer >= 100 (ms)")
	return { common, mib, files, pages, time }
}

const RANGE_BYTES = 1024 * 1024 // 1 MiB per range request

type SeededIoRange = {
	readonly bigPath: string
	readonly bigSize: number
	/** Offsets into the big file for the range tasks. */
	readonly offsets: readonly { readonly name: string; readonly start: number }[]
	/** Directory of `files` small files for the open/bulk/listing tasks. */
	readonly dir: string
	readonly firstFilePath: string
	/** A deflate cbz with `pages` entries for the virtual read task. */
	readonly cbzPath: string
	readonly teardown: () => Promise<void>
}

async function seedIoRange(args: SuiteIoRangeArgs): Promise<SeededIoRange> {
	const dir = mkdtempSync(join(tmpdir(), "io-range-bench-"))
	const bigSize = args.mib * 1024 * 1024
	const bigPath = join(dir, "big.bin")
	// Chunked write so seeding never holds the whole file in memory.
	const chunk = Buffer.alloc(8 * 1024 * 1024)
	for (let off = 0; off < bigSize; off += chunk.length) {
		randomFillSync(chunk)
		await writeFile(bigPath, chunk, { flag: off === 0 ? "w" : "a" })
	}

	const offsets = [0.1, 0.5, 0.9].map((pct) => ({
		name: `${Math.round(pct * 100)}pct`,
		start: Math.floor(bigSize * pct),
	}))

	const small = Buffer.alloc(8 * 1024, 0xa5)
	for (let k = 0; k < args.files; k += 1) {
		await writeFile(join(dir, `f-${String(k).padStart(4, "0")}.bin`), small)
	}

	const page = randomBytes(64 * 1024)
	const cbzPath = join(dir, "book.cbz")
	await writeFile(
		cbzPath,
		await buildZipBuffer(
			Array.from({ length: args.pages }, (_, k) => [
				`p-${String(k).padStart(3, "0")}.jpg`,
				page,
			]),
			true,
		),
	)

	return {
		bigPath,
		bigSize,
		offsets,
		dir,
		firstFilePath: join(dir, "f-0000.bin"),
		cbzPath,
		teardown: async () => {
			rmSync(dir, { recursive: true, force: true })
		},
	}
}

/** Drain a range through `sliceStream` over a full-file stream (historical path). */
async function drainDiscard(
	path: string,
	start: number,
	end: number,
): Promise<void> {
	for await (const _chunk of sliceStream(createReadStream(path), start, end)) {
		// drain
	}
}

/** Drain a range through a createReadStream window (fixed path). */
async function drainWindow(
	path: string,
	start: number,
	end: number,
): Promise<void> {
	for await (const _chunk of createReadStream(path, { start, end })) {
		// drain
	}
}

export const ioRangeSuite: BenchSuiteModule = {
	name: "io-range",
	title: "io range serving bench",
	flagSpecs: [
		{
			name: "mib",
			kind: "int",
			description: "big file size in MiB",
			default: 128,
		},
		{
			name: "files",
			kind: "int",
			description: "small files for open/bulk/listing",
			default: 100,
		},
		{
			name: "pages",
			kind: "int",
			description: "archive pages for the virtual read",
			default: 100,
		},
		{
			name: "time",
			kind: "int",
			description: "ms budget per task",
			default: 800,
		},
	],
	checkDefaults: { time: "600", mib: "128" },
	run: async (rawArgs, common) => {
		const args = resolveArgs(rawArgs, common)
		const machine = machineInfo()
		console.log(
			`mib: ${args.mib} | files: ${args.files} | pages: ${args.pages} | time: ${args.time}ms/task | out: ${common.out} | seed: ${common.seed}`,
		)

		const seedStart = performance.now()
		const seeded = await seedIoRange(args)
		console.log(
			`seeded ${args.mib}MiB file + ${args.files} files + ${args.pages}-page cbz in ${((performance.now() - seedStart) / 1000).toFixed(1)}s`,
		)

		const bench = new Bench({ time: args.time })
		const pageName = "p-000.jpg"
		const nested = createNestedAwareContainer(
			createDirectoryContainer(seeded.dir),
		)

		for (const offset of seeded.offsets) {
			const start = offset.start
			const end = start + RANGE_BYTES - 1
			bench.add(`range.discard.${offset.name}`, async () => {
				await drainDiscard(seeded.bigPath, start, end)
			})
			bench.add(`range.window.${offset.name}`, async () => {
				await drainWindow(seeded.bigPath, start, end)
			})
		}

		bench
			.add("open.statThenStream", async () => {
				const info = await stat(seeded.firstFilePath)
				const stream = createReadStream(seeded.firstFilePath)
				stream.destroy()
				return info.size
			})
			.add("open.handleFstat", async () => {
				// One path lookup (open), then fstat on the handle — the
				// single-walk alternative to stat + open.
				const handle = await open(seeded.firstFilePath, "r")
				try {
					const info = await handle.stat()
					return info.size
				} finally {
					await handle.close()
				}
			})
			.add("bulk.upfrontOpens", async () => {
				const names = await readdir(seeded.dir)
				const opened = names.map((name) =>
					createReadStream(join(seeded.dir, name)),
				)
				await Promise.all(names.map((name) => stat(join(seeded.dir, name))))
				for (const stream of opened) stream.destroy()
				return opened.length
			})
			.add("bulk.sizesFirst", async () => {
				const names = await readdir(seeded.dir)
				const sizes = await Promise.all(
					names.map((name) => stat(join(seeded.dir, name))),
				)
				for (const name of names) {
					const stream = createReadStream(join(seeded.dir, name))
					stream.destroy()
				}
				return sizes.length
			})
			.add("listEntries.memoHit", async () => {
				// The guarded memo pattern: one stat + map lookup instead
				// of the recursive walk + natural sort.
				const info = await stat(seeded.dir)
				return info.size
			})
			.add("listEntries.walk", async () => {
				const out: string[] = []
				async function collect(here: string, prefix: string): Promise<void> {
					const entries = await readdir(here, { withFileTypes: true })
					for (const entry of entries) {
						const rel = prefix ? `${prefix}/${entry.name}` : entry.name
						if (entry.isDirectory()) await collect(join(here, entry.name), rel)
						else if (entry.isFile()) out.push(rel)
					}
				}
				await collect(seeded.dir, "")
				out.sort((a, b) =>
					a.localeCompare(b, undefined, {
						sensitivity: "base",
						numeric: true,
					}),
				)
				return out.length
			})
			.add("virtual.range.64KB", async () => {
				// Inner page of a deflate archive: CD is cached, the page
				// bytes are inflated on demand.
				const entry = await nested.openEntryStream(`book.cbz!${pageName}`)
				let read = 0
				for await (const chunk of entry.stream) {
					read += chunk.length
					if (read >= RANGE_BYTES) break
				}
				return entry.size
			})

		await bench.run()

		const metrics = summarizeBenchTasks(bench.tasks)

		const report: BenchReport = {
			schema: 1,
			kind: "io-range",
			timestamp: new Date().toISOString(),
			config: {
				mib: args.mib,
				files: args.files,
				pages: args.pages,
				time: args.time,
				seed: common.seed,
			},
			machine,
			caveats: [
				"range.discard.* drains the full file from position 0 and discards the prefix (the historical sliceStream serving path) — its median grows with the requested offset; range.window.* reads only the 1MiB window via createReadStream(start,end). The ratio at 90pct is the seek regression the windowed path removes.",
				"open.statThenStream resolves the path twice (stat + open); open.handleFstat opens once and fstats the handle.",
				"bulk.upfrontOpens creates every read stream before any byte is written (first-byte latency); bulk.sizesFirst stats all files first and opens lazily at write time.",
				"listEntries.memoHit is the stat-signature guard that replaced the full walk + natural sort (listEntries.walk).",
				"virtual.range.64KB reads the first 1MiB of an inner deflate page through the nested container (CD cached).",
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
