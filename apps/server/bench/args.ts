/**
 * Suite module contract + CLI flag parsing: the table-driven flags every
 * suite declares (`flagSpecs`/`checkDefaults`), the shared flag surface
 * (`--out= --seed= --repeat= --threshold= --save --check --plugins=
 * --plugin=`), and the dispatcher that parses, banners and runs one suite
 * (`runSuiteModule`).
 *
 * `--check` applies each suite's checkDefaults (reduced corpus) for flags
 * not given explicitly, so saved baselines and the regression gate compare
 * the same corpus.
 */
import { resolve } from "node:path"
import { REPO_ROOT } from "./harness.ts"
import { type BenchMetric, type BenchReport, machineInfo } from "./report.ts"

// ── Shared CLI args ───────────────────────────────────────────────────────

export type CommonArgs = {
	out: string
	seed: number
	repeat: number
	thresholdPercent: number
	save: boolean
	check: boolean
	plugins: "stub" | "real"
	/** Dev plugin dist dir for real mode; undefined = builtin file plugin only. */
	plugin: string | undefined
}

/** Parse the flags shared by every suite (`--out= --seed= --repeat= --threshold= --save --check --plugins= --plugin=`). */
export function parseCommonArgs(
	argv: readonly string[],
	opts: {
		readonly defaultPlugins?: "stub" | "real"
		readonly checkDefaults?: Readonly<Record<string, string>>
	} = {},
): CommonArgs {
	const args: CommonArgs = {
		out: "baseline.json",
		seed: 42,
		repeat: 3,
		thresholdPercent: 25,
		save: false,
		check: false,
		plugins: opts.defaultPlugins ?? "stub",
		plugin: undefined,
	}
	let explicitRepeat = false
	for (const arg of argv) {
		if (arg.startsWith("--out=")) {
			args.out = arg.slice("--out=".length)
		} else if (arg.startsWith("--seed=")) {
			args.seed = Number(arg.slice("--seed=".length))
		} else if (arg.startsWith("--repeat=")) {
			args.repeat = Number(arg.slice("--repeat=".length))
			explicitRepeat = true
			if (!Number.isInteger(args.repeat) || args.repeat < 1) {
				throw new Error("--repeat must be a positive integer")
			}
		} else if (arg.startsWith("--threshold=")) {
			args.thresholdPercent = Number(arg.slice("--threshold=".length))
			if (
				!Number.isFinite(args.thresholdPercent) ||
				args.thresholdPercent < 0
			) {
				throw new Error("--threshold must be a non-negative number")
			}
		} else if (arg === "--save") {
			args.save = true
		} else if (arg === "--check") {
			args.check = true
		} else if (arg.startsWith("--plugins=")) {
			const mode = arg.slice("--plugins=".length)
			if (mode !== "stub" && mode !== "real") {
				throw new Error(`--plugins must be stub|real, got "${mode}"`)
			}
			args.plugins = mode
		} else if (arg.startsWith("--plugin=")) {
			args.plugin = arg.slice("--plugin=".length)
		}
	}
	// --check/--save use the suite's reduced profile unless the flag was
	// explicit, so saved baselines and the regression gate compare the
	// same corpus (wall/throughput metrics would otherwise be
	// incomparable between a full-corpus baseline and the reduced check).
	if (
		(args.check || args.save) &&
		!explicitRepeat &&
		opts.checkDefaults?.repeat !== undefined
	) {
		args.repeat = Number(opts.checkDefaults.repeat)
	}
	if (args.plugin !== undefined) {
		if (args.plugins !== "real") {
			throw new Error("--plugin is only meaningful with --plugins=real")
		}
		args.plugin = resolve(REPO_ROOT, args.plugin)
	}
	return args
}

// ── Suite modules (internal script CLI) ──────────────────────────────────

export type FlagKind = "int" | "intList" | "number"

export type FlagSpec = {
	readonly name: string
	readonly kind: FlagKind
	readonly description: string
	readonly default: number | readonly number[]
}

/** Suite-specific args, typed at the suite boundary via the `*Arg` helpers. */
export type SuiteArgs = Record<string, number | readonly number[]>

export function intArg(args: SuiteArgs, name: string): number {
	const value = args[name]
	if (typeof value !== "number") {
		throw new Error(`missing int flag --${name}`)
	}
	return value
}

export function intListArg(args: SuiteArgs, name: string): readonly number[] {
	const value = args[name]
	if (!Array.isArray(value)) {
		throw new Error(`missing int-list flag --${name}`)
	}
	return value as readonly number[]
}

export function numberArg(args: SuiteArgs, name: string): number {
	const value = args[name]
	if (typeof value !== "number") {
		throw new Error(`missing number flag --${name}`)
	}
	return value
}

export type SuiteRunResult = {
	readonly common: CommonArgs
	readonly report: BenchReport
	readonly extractMetrics: (report: BenchReport) => readonly BenchMetric[]
}

/**
 * A benchmark suite module: declares its flags table-driven, runs against
 * a parsed arg set, and returns a report with its metric
 * extraction. The CLI dispatcher (bench/cli.ts) owns parsing, banners,
 * and baseline save/check.
 */
export type BenchSuiteModule = {
	readonly name: string
	readonly title: string
	/** Default `--plugins=` mode when the suite uses plugin wiring. */
	readonly defaultPlugins?: "stub" | "real"
	readonly flagSpecs: readonly FlagSpec[]
	/**
	 * Flag overrides applied when `--check` runs and the flag was not
	 * given explicitly — the reduced corpus that keeps CI checks fast.
	 */
	readonly checkDefaults?: Readonly<Record<string, string>>
	readonly run: (args: SuiteArgs, common: CommonArgs) => Promise<SuiteRunResult>
}

function parseFlagValue(
	spec: FlagSpec,
	raw: string,
): number | readonly number[] {
	switch (spec.kind) {
		case "int": {
			const n = Number(raw)
			if (!Number.isInteger(n)) {
				throw new Error(`--${spec.name} must be an integer, got "${raw}"`)
			}
			return n
		}
		case "intList": {
			const list = raw
				.split(",")
				.map((s) => Number(s.trim()))
				.filter((n) => Number.isInteger(n) && n > 0)
			if (list.length === 0) {
				throw new Error(`no valid integers parsed from --${spec.name}=`)
			}
			return list
		}
		case "number": {
			const n = Number(raw)
			if (!Number.isFinite(n)) {
				throw new Error(`--${spec.name} must be a number, got "${raw}"`)
			}
			return n
		}
	}
}

/**
 * Parse suite-specific flags from argv; `checkDefaults` win over defaults
 * under `--check`/`--save` so baseline and gate runs share one corpus.
 */
export function parseSuiteArgs(
	argv: readonly string[],
	specs: readonly FlagSpec[],
	checkDefaults: Readonly<Record<string, string>> | undefined,
	check: boolean,
): SuiteArgs {
	const args: SuiteArgs = {}
	for (const spec of specs) {
		let raw: string | undefined
		for (const arg of argv) {
			if (arg.startsWith(`--${spec.name}=`)) {
				raw = arg.slice(`--${spec.name}=`.length)
			}
		}
		if (
			raw === undefined &&
			check &&
			checkDefaults?.[spec.name] !== undefined
		) {
			raw = checkDefaults[spec.name]
		}
		args[spec.name] =
			raw === undefined ? spec.default : parseFlagValue(spec, raw)
	}
	return args
}

/** Run one suite: parse, banner, execute, return report + extraction. */
export async function runSuiteModule(
	suite: BenchSuiteModule,
	argv: readonly string[],
): Promise<SuiteRunResult> {
	const common = parseCommonArgs(argv, {
		defaultPlugins: suite.defaultPlugins,
		checkDefaults: suite.checkDefaults,
	})
	const args = parseSuiteArgs(
		argv,
		suite.flagSpecs,
		suite.checkDefaults,
		common.check || common.save,
	)
	const machine = machineInfo()
	console.log(
		`${suite.title} | node ${process.version} | ${machine.platform}/${machine.arch} | ${machine.cpus} cpus (${machine.cpuModel})`,
	)
	if (common.save) {
		console.log(
			"mode: --save (baseline will be written; reduced corpus, same profile as --check)",
		)
	}
	if (common.check) {
		console.log(
			`mode: --check (regression gate vs baseline, threshold ${common.thresholdPercent}%)`,
		)
	}
	console.log(
		"comparison rule: only same-window paired runs are comparable (bimodal machine load)",
	)
	return suite.run(args, common)
}

/** Format one suite's flag table for `--help`. */
export function formatSuiteHelp(suite: BenchSuiteModule): string {
	const flags = suite.flagSpecs
		.map(
			(spec) =>
				`    --${spec.name}=<${spec.kind}> (default ${Array.isArray(spec.default) ? spec.default.join(",") : spec.default}) — ${spec.description}`,
		)
		.join("\n")
	return `${suite.name} — ${suite.title}\n${flags}`
}
