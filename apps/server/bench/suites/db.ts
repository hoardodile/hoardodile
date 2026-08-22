/**
 * Micro-benchmarks (tinybench) for the DB/query layer over a seeded
 * corpus — the per-request cost of the hot resource queries and row
 * mapping. Each task is a hot loop over a real repository call, so the
 * measured cost is exactly what one production request pays: Drizzle
 * SQL building + cached statement prepare + execute + hydrate.
 *
 * The corpus is a temp file DB (the raw better-sqlite3 floor needs a
 * second connection; a file also keeps page-cache behaviour close to
 * production). Seeding is deterministic (`--seed=`).
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench db
 *   pnpm -F @hoardodile/server bench db --rows=20000 --time=1500
 *   pnpm -F @hoardodile/server bench db --check (regression gate vs bench/baselines/db.json)
 *
 * Results are written as JSON to <repo>/tmp/bench/<out>; `--save` also
 * writes the suite baseline. Shared infra lives in ../harness.ts.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { count, desc, inArray, isNull } from "drizzle-orm"
import { buildCharacterRepository } from "src/domain/char/repo.ts"
import {
	buildResourceRepository,
	type ResCardRow,
	type ResRow,
	rowToResource,
	rowToResourceCard,
} from "src/domain/res/repo.ts"
import { resourceMeta, resources } from "src/domain/res/schema.ts"
import { buildTagRepository } from "src/domain/tag/repo.ts"
import { resTags } from "src/domain/tag/schema.ts"
import { openDb } from "src/infra/db/connection.ts"
import { Bench } from "tinybench"
import {
	type BenchSuiteModule,
	type CommonArgs,
	intArg,
	type SuiteArgs,
} from "../args.ts"
import {
	BENCH_STUB_PLUGIN_ID,
	mulberry32,
	roundMb,
	summarizeBenchTasks,
} from "../harness.ts"
import {
	type BenchReport,
	extractStoredMetrics,
	machineInfo,
} from "../report.ts"

type SuiteDbArgs = {
	readonly common: CommonArgs
	readonly rows: number
	readonly time: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuiteDbArgs {
	const rows = intArg(args, "rows")
	const time = intArg(args, "time")
	if (rows < 100) throw new Error("--rows must be an integer >= 100")
	if (time < 100)
		throw new Error("--time must be an integer >= 100 (ms per task)")
	return { common, rows, time }
}

type SeededDb = {
	readonly db: ReturnType<typeof openDb>["db"]
	readonly repo: ReturnType<typeof buildResourceRepository>
	readonly ids: readonly string[]
	readonly pageRows: readonly ResRow[]
	readonly cardRows: readonly ResCardRow[]
	/** Raw better-sqlite3 handle for the SQL floor measurements. */
	readonly raw: BetterSqlite3.Database
	readonly teardown: () => void
}

function seedDb(rows: number, seed: number): SeededDb {
	const rand = mulberry32(seed)
	const dir = mkdtempSync(join(tmpdir(), "db-bench-"))
	const dbPath = join(dir, "db.sqlite")
	const dbh = openDb(dbPath)
	dbh.runMigrations()
	const db = dbh.db
	const repo = buildResourceRepository(db)
	const tagRepo = buildTagRepository(db)
	const charRepo = buildCharacterRepository(db)

	const tagIds: string[] = []
	for (let i = 0; i < 50; i++) {
		const id = `tag-${i}`
		tagRepo.insert(
			id,
			{
				name: `tag-${i}`,
				intro: "",
				color: i % 5 === 0 ? "#ababab" : "",
				position: i,
				pinned: i < 10,
				catId: null,
			},
			Date.now(),
		)
		tagIds.push(id)
	}
	const charIds: string[] = []
	for (let i = 0; i < 30; i++) {
		const id = `char-${i}`
		charRepo.insert(
			id,
			{ name: `char-${i}`, intro: "", traitValues: "{}", tagIds: [] },
			Date.now(),
			1,
		)
		charIds.push(id)
	}

	const ids: string[] = []
	for (let i = 0; i < rows; i++) {
		const id = `res-${String(i).padStart(6, "0")}`
		const tagIdsFor =
			rand() < 0.3 ? [tagIds[Math.floor(rand() * tagIds.length)]!] : []
		const charIdsFor =
			rand() < 0.2 ? [charIds[Math.floor(rand() * charIds.length)]!] : []
		repo.insert(
			id,
			{
				name: `bench res ${i}`,
				intro: "",
				contentPluginId: BENCH_STUB_PLUGIN_ID,
				tagIds: tagIdsFor,
				charIds: charIdsFor,
			},
			Date.now() + i,
			1,
		)
		repo.patchMeta(
			id,
			{
				searchMeta:
					rand() < 0.15
						? JSON.stringify({ v: 1, facets: { shounen: true } })
						: JSON.stringify({ v: 1, facets: {} }),
				coverMeta: JSON.stringify({
					kind: "image",
					width: 400,
					height: 600,
				}),
				fileStats: JSON.stringify({ count: 10, sizeBytes: 100_000 }),
			},
			Date.now() + i,
		)
		ids.push(id)
	}

	const page = repo.listPage({
		trashed: false,
		query: undefined,
		page: 1,
		size: 200,
	})
	const cardPage = repo.listCardPage({
		trashed: false,
		query: undefined,
		page: 1,
		size: 200,
	})
	const raw = new BetterSqlite3(dbPath)
	return {
		db: db,
		repo,
		ids,
		pageRows: page.rows,
		cardRows: cardPage.rows,
		raw,
		teardown: () => {
			raw.close()
			dbh.close()
			rmSync(dir, { recursive: true, force: true })
		},
	}
}

export const dbSuite: BenchSuiteModule = {
	name: "db",
	title: "db micro bench",
	flagSpecs: [
		{
			name: "rows",
			kind: "int",
			description: "seeded resource rows",
			default: 10_000,
		},
		{
			name: "time",
			kind: "int",
			description: "ms budget per task",
			default: 800,
		},
	],
	checkDefaults: { rows: "5000", time: "600" },
	run: async (rawArgs, common) => {
		const args = resolveArgs(rawArgs, common)
		const machine = machineInfo()
		console.log(
			`rows: ${args.rows} | time: ${args.time}ms/task | out: ${common.out} | seed: ${common.seed}`,
		)

		const seedStart = performance.now()
		const seeded = seedDb(args.rows, common.seed)
		console.log(
			`seeded ${args.rows} rows in ${((performance.now() - seedStart) / 1000).toFixed(1)}s`,
		)
		const { db, repo, ids, pageRows, cardRows, raw } = seeded

		let cursor = 0
		const nextId = () => ids[cursor++ % ids.length]!
		const rawSql =
			"SELECT * FROM resources ORDER BY created_at DESC LIMIT 200 OFFSET 0"
		const pageIds = pageRows.map((r) => r.id)

		const bench = new Bench({ time: args.time })
		bench
			.add("findById", () => {
				repo.findById(nextId())
			})
			.add("findCardById", () => {
				repo.findCardById(nextId())
			})
			.add("listPage", () => {
				repo.listPage({ trashed: false, query: undefined, page: 1, size: 200 })
			})
			.add("listPage.countOnly", () => {
				db.select({ total: count() })
					.from(resources)
					.where(isNull(resources.deletedAt))
					.get()
			})
			.add("listPage.pageOnly", () => {
				db.select()
					.from(resources)
					.where(isNull(resources.deletedAt))
					.orderBy(desc(resources.createdAt), desc(resources.id))
					.limit(200)
					.offset(0)
					.all()
			})
			.add("listPage.metaBatch", () => {
				db.select()
					.from(resourceMeta)
					.where(inArray(resourceMeta.resourceId, pageIds))
					.all()
			})
			.add("listPage.hydrateTags", () => {
				db.select().from(resTags).where(inArray(resTags.resId, pageIds)).all()
			})
			.add("listPage.nameQuery", () => {
				repo.listPage({
					trashed: false,
					query: "bench res 1",
					page: 1,
					size: 200,
				})
			})
			.add("listPage.facet", () => {
				repo.listPage({
					trashed: false,
					query: undefined,
					page: 1,
					size: 200,
					searchMetaFacets: { shounen: true },
				})
			})
			.add("listPage.random", () => {
				repo.listPage({
					trashed: false,
					query: undefined,
					page: 1,
					size: 200,
					random: true,
					seed: "bench-seed",
				})
			})
			.add("listCardPage", () => {
				repo.listCardPage({
					trashed: false,
					query: undefined,
					page: 1,
					size: 200,
				})
			})
			.add("rowToResource.200rows", () => {
				for (const row of pageRows) rowToResource(row)
			})
			.add("rowToResourceCard.200rows", () => {
				for (const row of cardRows) rowToResourceCard(row)
			})
			.add("rawSql.preppedGet", () => {
				raw.prepare(rawSql).all()
			})

		await bench.run()

		const metrics = summarizeBenchTasks(bench.tasks)

		const report: BenchReport = {
			schema: 1,
			kind: "db",
			timestamp: new Date().toISOString(),
			config: { rows: args.rows, time: args.time, seed: common.seed },
			machine,
			caveats: [
				"Tinybench runs each task as a hot loop until the --time budget; this amortizes per-iteration overhead and measures steady-state per-request cost (Drizzle SQL build + cached prepare + execute + hydrate).",
				"listPage.nameQuery uses a LIKE '%bench res 1%' filter; listPage.facet exercises the json_extract(searchMeta) EXISTS subquery; listPage.random the seeded hash() ordering.",
				"rawSql.preppedGet is the raw better-sqlite3 floor (prepared once inside the loop, cached prepare); the delta to the Drizzle tasks is the query-builder overhead.",
				"Corpus: `--rows` resources with ~15% facet rows, ~30% with a tag, ~20% with a character; 50 tags (10 pinned) and 30 characters seed the listCardPage batch joins.",
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
