/**
 * Internal benchmark CLI — the single entry point for the server bench
 * suites. Suites are modules in `suites/` declaring their flags
 * table-driven; this dispatcher owns arg routing, banners, baseline
 * save/check, and exit codes (0 pass / 1 regression / 2 error).
 *
 * The process entry lives in `run.ts`; this module exports the same
 * surface so tests can drive the dispatcher without spawning a process.
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench                         # all suites, full corpus
 *   pnpm -F @hoardodile/server bench io --tiers=100          # one suite
 *   pnpm -F @hoardodile/server bench --check                 # reduced corpus + regression gate
 *   pnpm -F @hoardodile/server bench --save                  # write baselines
 *   pnpm -F @hoardodile/server bench --help
 *
 * Shared flags (see harness.ts parseCommonArgs): --out= --seed= --repeat=
 * --threshold= --save --check --plugins= --plugin=. Suite flags: --tiers=
 * --files= --bytes= --pool-noise= --chars= --video-ratio= --rows= --time=.
 * `--check` applies each suite's checkDefaults (reduced corpus) for flags
 * not given explicitly.
 */
import {
	type BenchSuiteModule,
	formatSuiteHelp,
	runSuiteModule,
} from "./args.ts"
import { finishBench } from "./report.ts"
import { archive7zSuite } from "./suites/archive-7z.ts"
import { dbSuite } from "./suites/db.ts"
import { ioSuite } from "./suites/io.ts"
import { ioMicroSuite } from "./suites/io-micro.ts"
import { ioRangeSuite } from "./suites/io-range.ts"
import { pluginSuite } from "./suites/plugin.ts"
import { precacheSuite } from "./suites/precache.ts"

const SUITES: readonly BenchSuiteModule[] = [
	ioSuite,
	precacheSuite,
	pluginSuite,
	dbSuite,
	ioMicroSuite,
	ioRangeSuite,
	archive7zSuite,
]

const SUITE_BY_NAME = new Map(SUITES.map((suite) => [suite.name, suite]))

export function printHelp(): string {
	const help = [
		"hoardodile server bench",
		"",
		"usage: pnpm -F @hoardodile/server bench [<suite>] [flags]",
		"       (no suite = run all in order, stopping on the first failure)",
		"",
		"shared flags: --out=<file> --seed=<n> --repeat=<n> --threshold=<pct>",
		"              --save --check --plugins=stub|real --plugin=<dist>",
		"",
		"suites:",
		...SUITES.map((suite) => formatSuiteHelp(suite)),
		"",
		"--check runs each suite with its reduced corpus (checkDefaults)",
		"and compares against bench/baselines/<suite>.json (exit 1 on regression).",
		"--save writes fresh baselines on the same reduced corpus as --check;",
		"results also land in tmp/bench/.",
	].join("\n")
	console.log(help)
	return help
}

export function resolveSuites(
	positional: string | undefined,
): readonly BenchSuiteModule[] {
	if (positional === undefined) return SUITES
	const suite = SUITE_BY_NAME.get(positional)
	if (suite === undefined) {
		throw new Error(
			`unknown suite "${positional}" — expected one of: ${SUITES.map((s) => s.name).join(", ")}`,
		)
	}
	return [suite]
}

export async function runCli(argv: readonly string[]): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		printHelp()
		return
	}
	// The first non-flag token is the suite name; everything else is flags.
	const positional = argv.find((arg) => !arg.startsWith("--"))
	const suites = resolveSuites(positional)
	for (const suite of suites) {
		const { common, report, extractMetrics } = await runSuiteModule(suite, argv)
		await finishBench({
			suite: suite.name,
			out: common.out,
			report,
			extractMetrics,
			common,
		})
		// Stop the run like the old `&&` chain: a regression or error in
		// one suite aborts the rest.
		if (process.exitCode !== 0) break
	}
}
