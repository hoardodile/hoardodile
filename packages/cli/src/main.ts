import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import {
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	HOOK_NAMES,
	type HookName,
	type PluginDefinition,
	type PluginHooks,
} from "@hoardodile/host"
import { ok } from "@hoardodile/sdk-types"
import { defineCommand } from "citty"
import {
	type BenchReport,
	benchExitCode,
	compareBaseline,
	computeBenchReport,
	formatBenchSummary,
	loadBaseline,
	writeReport,
} from "./bench.ts"
import { buildPlugin } from "./build.ts"
import { executeCreate } from "./create.ts"
import { executeDev } from "./dev.ts"
import { packPlugin } from "./package.ts"
import {
	buildCliResourceAPI,
	CliError,
	createCliHooks,
	EXIT_ERROR,
	EXIT_PASS,
	type PluginTarget,
	resolvePluginTarget,
	runCliHook,
} from "./runner.ts"

/**
 * `hoardodile` — the developer CLI. The `plugin` group builds, runs,
 * benchmarks and develops content plugins against the same host
 * implementation the server uses (worker sandbox + hook strategy + real
 * probes), so what you test is what runs in production.
 */

function parseRepeat(value: string | undefined): number {
	if (value === undefined) return 5
	const n = Number.parseInt(value, 10)
	if (!Number.isFinite(n) || n < 1) {
		throw new CliError(`--repeat must be a positive integer, got "${value}"`)
	}
	return n
}

function parseWarmup(value: string | undefined): number {
	if (value === undefined) return 1
	const n = Number.parseInt(value, 10)
	if (!Number.isFinite(n) || n < 0) {
		throw new CliError(
			`--warmup must be a non-negative integer, got "${value}"`,
		)
	}
	return n
}

function parseThreshold(value: string | undefined): number {
	if (value === undefined) return 20
	const n = Number.parseFloat(value)
	if (!Number.isFinite(n) || n < 0) {
		throw new CliError(
			`--threshold must be a non-negative number, got "${value}"`,
		)
	}
	return n
}

function parseHook(value: string): HookName {
	if (!(HOOK_NAMES as readonly string[]).includes(value)) {
		throw new CliError(
			`unknown hook "${value}" — expected one of: ${HOOK_NAMES.join(", ")}`,
		)
	}
	return value as HookName
}

function parsePort(value: string): number {
	const n = Number.parseInt(value, 10)
	if (!Number.isFinite(n) || n < 1 || n > 65535) {
		throw new CliError(`--port must be a valid port number, got "${value}"`)
	}
	return n
}

export const main = defineCommand({
	meta: {
		name: "hoardodile",
		description:
			"hoardodile developer CLI — content-plugin create, build, run, bench and dev commands.",
	},
	subCommands: {
		plugin: defineCommand({
			meta: {
				name: "plugin",
				description: "Content-plugin developer commands.",
			},
			subCommands: {
				create: defineCommand({
					meta: {
						name: "create",
						description:
							"Scaffold a new content plugin (runs create-hoardodile-plugin via pnpm dlx).",
					},
					args: {
						name: {
							type: "positional",
							description:
								"Plugin directory name (npm-style, lowercase letters, digits and dashes). Defaults to an interactive prompt.",
						},
						tarballs: {
							type: "string",
							description:
								"Directory of packed SDK tarballs; rewires the scaffolded plugin's SDK deps to them.",
						},
					},
					async run({ args }) {
						return executeCreate({
							name: args.name,
							tarballs: args.tarballs,
						})
					},
				}),
				run: defineCommand({
					meta: {
						name: "run",
						description:
							"Run one plugin hook against a directory and print the JSON result.",
					},
					args: {
						hook: {
							type: "positional",
							required: true,
							description: `Hook to run: ${HOOK_NAMES.join(", ")}`,
						},
						dir: {
							type: "positional",
							required: true,
							description: "Data directory the hook reads from.",
						},
						pluginDir: {
							type: "string",
							description:
								"Plugin directory (manifest.json + main.js). Defaults to the --main parent.",
						},
						main: {
							type: "string",
							description:
								"Path to the built plugin main.js. Defaults to <plugin-dir>/main.js.",
						},
						inProcess: {
							type: "boolean",
							description:
								"Run the hook in-process instead of through the worker sandbox. Debugging only — bypasses the production execution path.",
						},
						pretty: {
							type: "boolean",
							description: "Pretty-print the JSON result (indented).",
						},
					},
					async run({ args }) {
						return executeRun({
							hook: parseHook(args.hook ?? ""),
							dir: args.dir ?? "",
							pluginDir: args.pluginDir,
							main: args.main,
							inProcess: args.inProcess === true,
							pretty: args.pretty === true,
						})
					},
				}),
				bench: defineCommand({
					meta: {
						name: "bench",
						description:
							"Measure hook duration (sandboxed, real probes) and compare against a baseline.",
					},
					args: {
						hook: {
							type: "positional",
							required: true,
							description: `Hook to benchmark: ${HOOK_NAMES.join(", ")}`,
						},
						dir: {
							type: "positional",
							required: true,
							description: "Data directory the hook reads from.",
						},
						pluginDir: {
							type: "string",
							description:
								"Plugin directory (manifest.json + main.js). Defaults to the --main parent.",
						},
						main: {
							type: "string",
							description:
								"Path to the built plugin main.js. Defaults to <plugin-dir>/main.js.",
						},
						inProcess: {
							type: "boolean",
							description:
								"Run in-process instead of through the worker sandbox. Debugging only.",
						},
						repeat: {
							type: "string",
							description:
								"Measured iterations after the warmup runs. Default 5.",
						},
						warmup: {
							type: "string",
							description:
								"Discarded warmup runs before the measured samples. Default 1.",
						},
						json: {
							type: "string",
							description: "Write the JSON report to this file.",
						},
						save: {
							type: "string",
							description: "Save a fresh baseline report to this file.",
						},
						compare: {
							type: "string",
							description:
								"Compare against a previous report file; exit 1 when the median regresses past --threshold.",
						},
						threshold: {
							type: "string",
							description:
								"Regression threshold in percent of the baseline median. Default 20.",
						},
					},
					async run({ args }) {
						return executeBench({
							hook: parseHook(args.hook ?? ""),
							dir: args.dir ?? "",
							pluginDir: args.pluginDir,
							main: args.main,
							inProcess: args.inProcess === true,
							repeat: parseRepeat(args.repeat),
							warmupRuns: parseWarmup(args.warmup),
							thresholdPercent: parseThreshold(args.threshold),
							jsonPath: args.json,
							savePath: args.save,
							comparePath: args.compare,
						})
					},
				}),
				dev: defineCommand({
					meta: {
						name: "dev",
						description:
							"Build a plugin in watch mode and serve it in the workbench (default http://127.0.0.1:5199), with sandboxed hooks, preview variants and video frames.",
					},
					args: {
						pluginDir: {
							type: "string",
							description:
								"Plugin directory (manifest.json + package.json). Defaults to the current directory.",
						},
						data: {
							type: "string",
							description:
								"Data directory served as a single resource. Defaults to <plugin-dir>/testdata when it exists.",
						},
						resourceDir: {
							type: "string",
							description:
								"Directory whose direct subfolders each become a resource (a folder of many test-data items). Mutually exclusive with --data and --storage.",
						},
						storage: {
							type: "string",
							description:
								"hoardodile storage root to develop against. Opened READ-ONLY: resources come from app.sqlite and their bare-file folders, and plugin writes stay in the workbench's in-memory mock.",
						},
						res: {
							type: "string",
							description:
								"Resource id to capture first when serving a storage root.",
						},
						port: {
							type: "string",
							description: "Workbench port. Default 5199.",
						},
					},
					async run({ args }) {
						return executeDev({
							pluginDir: args.pluginDir ?? "",
							dataDir: args.data,
							resourceRootDir: args.resourceDir,
							storageDir: args.storage,
							resId: args.res,
							port: args.port === undefined ? 5199 : parsePort(args.port),
						})
					},
				}),
				build: defineCommand({
					meta: {
						name: "build",
						description:
							"Build a plugin in the current directory (manifest.json + src/ + index.html) into dist/. Pass --watch to rebuild on change.",
					},
					args: {
						watch: {
							type: "boolean",
							description: "Rebuild on file changes instead of exiting.",
						},
					},
					async run({ args }) {
						return executeBuild({
							dir: process.cwd(),
							watch: args.watch === true,
						})
					},
				}),
				package: defineCommand({
					meta: {
						name: "package",
						description:
							"Build a plugin and zip dist/ into release/<id>-<version>.zip — the artifact to attach to a GitHub release for the app's plugin marketplace.",
					},
					args: {
						pluginDir: {
							type: "string",
							description:
								"Plugin directory (manifest.json + package.json). Defaults to the current directory.",
						},
						skipBuild: {
							type: "boolean",
							description:
								"Do not rebuild before packaging (uses the existing dist/).",
						},
					},
					async run({ args }) {
						return executePackage({
							dir: args.pluginDir ?? process.cwd(),
							skipBuild: args.skipBuild === true,
						})
					},
				}),
			},
		}),
	},
})

type RunOptions = {
	readonly hook: HookName
	readonly dir: string
	readonly pluginDir?: string
	readonly main?: string
	readonly inProcess: boolean
	readonly pretty?: boolean
}

async function executeRun(opts: RunOptions): Promise<number> {
	const exitCode = await executeRunInner(opts)
	process.exitCode = exitCode
	return exitCode
}

async function executeRunInner(opts: RunOptions): Promise<number> {
	try {
		const target = resolvePluginTarget({
			pluginDir: opts.pluginDir,
			main: opts.main,
		})
		await ensureFreshBuild(target)
		// A scratch extraction cache lets `extractArchive`-driven hooks
		// run against archive fixtures exactly as they do on the server.
		const extractCacheDir = mkdtempSync(join(tmpdir(), "hoard-cli-extract-"))
		try {
			const outcome = opts.inProcess
				? await runInProcess(
						target.mainPath,
						opts.hook,
						opts.dir,
						extractCacheDir,
					)
				: await withSandboxHooks(target, (hooks) =>
						runCliHook({
							id: target.id,
							hooks,
							hook: opts.hook,
							dir: opts.dir,
							extractCacheDir,
						}),
					)
			console.log(JSON.stringify(outcome, null, opts.pretty ? 2 : 0))
		} finally {
			rmSync(extractCacheDir, { recursive: true, force: true })
		}
		return EXIT_PASS
	} catch (err) {
		console.error(
			`[hoardodile] ${err instanceof Error ? err.message : String(err)}`,
		)
		return EXIT_ERROR
	}
}

type BenchOptions = {
	readonly hook: HookName
	readonly dir: string
	readonly pluginDir?: string
	readonly main?: string
	readonly inProcess: boolean
	readonly repeat: number
	readonly warmupRuns: number
	readonly thresholdPercent: number
	readonly jsonPath?: string
	readonly savePath?: string
	readonly comparePath?: string
}

async function executeBench(opts: BenchOptions): Promise<number> {
	const exitCode = await executeBenchInner(opts)
	process.exitCode = exitCode
	return exitCode
}

async function executeBenchInner(opts: BenchOptions): Promise<number> {
	try {
		const target = resolvePluginTarget({
			pluginDir: opts.pluginDir,
			main: opts.main,
		})
		await ensureFreshBuild(target)
		if (opts.inProcess) {
			const report = await computeBenchReport({
				pluginId: target.id,
				hook: opts.hook,
				dir: opts.dir,
				repeat: opts.repeat,
				warmupRuns: opts.warmupRuns,
				run: () => runInProcess(target.mainPath, opts.hook, opts.dir),
			})
			return finishBench(report, opts)
		}
		// One sandbox + one loaded plugin for the whole run: the warmup
		// iterations pay the worker spawn; samples measure steady-state
		// hook execution through the strategy facade.
		const sandbox = createPluginSandbox(DEFAULT_SANDBOX_CONFIG)
		try {
			const hooks = await createCliHooks(target, sandbox)
			const report = await computeBenchReport({
				pluginId: target.id,
				hook: opts.hook,
				dir: opts.dir,
				repeat: opts.repeat,
				warmupRuns: opts.warmupRuns,
				run: () =>
					runCliHook({ id: target.id, hooks, hook: opts.hook, dir: opts.dir }),
			})
			return finishBench(report, opts)
		} finally {
			await sandbox.disposeAll()
		}
	} catch (err) {
		console.error(
			`[hoardodile] ${err instanceof Error ? err.message : String(err)}`,
		)
		return EXIT_ERROR
	}
}

function finishBench(report: BenchReport, opts: BenchOptions): number {
	console.log(formatBenchSummary(report))
	let compare: ReturnType<typeof compareBaseline> | undefined
	if (opts.comparePath !== undefined) {
		const baseline = loadBaseline(opts.comparePath)
		compare = compareBaseline(report, baseline, opts.thresholdPercent)
		console.log(compare.message)
	}
	if (opts.savePath !== undefined) writeReport(opts.savePath, report)
	if (opts.jsonPath !== undefined) writeReport(opts.jsonPath, report)
	return benchExitCode(compare)
}

type BuildOptions = {
	readonly dir: string
	readonly watch: boolean
}

async function executeBuild(opts: BuildOptions): Promise<number> {
	try {
		await buildPlugin(opts.dir, { watch: opts.watch })
		return EXIT_PASS
	} catch (err) {
		console.error(
			`[hoardodile] ${err instanceof Error ? err.message : String(err)}`,
		)
		return EXIT_ERROR
	}
}

type PackageOptions = {
	readonly dir: string
	readonly skipBuild: boolean
}

async function executePackage(opts: PackageOptions): Promise<number> {
	try {
		const result = await packPlugin(opts.dir, { skipBuild: opts.skipBuild })
		console.log(`${result.id} v${result.version} → ${result.zipPath}`)
		console.log(`checksum: ${result.sha256Path}`)
		console.log(`registry line: ${result.registryLine}`)
		console.log(`publish: ${result.publishHint}`)
		return EXIT_PASS
	} catch (err) {
		console.error(
			`[hoardodile] ${err instanceof Error ? err.message : String(err)}`,
		)
		return EXIT_ERROR
	}
}

/** One sandbox + one loaded plugin for a single hook invocation. */
async function withSandboxHooks<T>(
	target: PluginTarget,
	fn: (hooks: PluginHooks) => Promise<T>,
): Promise<T> {
	const sandbox = createPluginSandbox(DEFAULT_SANDBOX_CONFIG)
	try {
		const hooks = await createCliHooks(target, sandbox)
		return await fn(hooks)
	} finally {
		await sandbox.disposeAll()
	}
}

/**
 * Rebuild a plugin's `dist/` when its sources are newer than the built
 * bundle — `plugin run`/`bench` execute the built `main.js`, so a
 * stale build silently runs old code. Only applies when the target
 * dir is a plugin's `dist/` sitting next to its sources
 * (`<plugin>/dist/` with `<plugin>/src/`); explicit `--main` bundles
 * are used as-is.
 */
async function ensureFreshBuild(target: PluginTarget): Promise<void> {
	const distDir = target.dirPath
	const pluginDir = dirname(distDir)
	const srcDir = join(pluginDir, "src")
	const manifestPath = join(pluginDir, "manifest.json")
	if (!existsSync(srcDir) || !existsSync(manifestPath)) return
	if (!existsSync(join(distDir, "main.js"))) return
	const distMtime = newestFileMtime(distDir)
	const newestSource = Math.max(
		newestFileMtime(srcDir),
		statSync(manifestPath).mtimeMs,
	)
	// Small tolerance for coarse filesystem mtime granularity (FAT, zip
	// round-trips) so a source written a moment before the build is not
	// judged stale by a rounding difference.
	const REBUILD_TOLERANCE_MS = 2_000
	if (distMtime + REBUILD_TOLERANCE_MS <= newestSource) {
		console.log(`[hoardodile] dist/ is stale — rebuilding ${pluginDir}`)
		await buildPlugin(pluginDir, { watch: false })
	}
}

/** Newest mtime under a directory tree (files only), or 0 when empty. */
function newestFileMtime(dir: string): number {
	let newest = 0
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			newest = Math.max(newest, newestFileMtime(full))
		} else if (entry.isFile()) {
			newest = Math.max(newest, statSync(full).mtimeMs)
		}
	}
	return newest
}

/** Unsandboxed hook call for `--in-process` debugging. */
async function runInProcess(
	mainPath: string,
	hook: HookName,
	dir: string,
	extractCacheDir?: string,
) {
	const mod: unknown = await import(pathToFileURL(mainPath).href)
	if (typeof mod !== "object" || mod === null || !("default" in mod)) {
		throw new CliError(
			`plugin at ${mainPath} must default-export a plugin definition`,
		)
	}
	const def = (mod as { default: PluginDefinition }).default
	const fn = def[hook]
	if (typeof fn !== "function") {
		throw new CliError(`plugin has no ${hook} hook`)
	}
	const api = buildCliResourceAPI(dir, { extractCacheDir })
	const started = performance.now()
	const result = await fn(api)
	return ok({ result, durationMs: performance.now() - started })
}
