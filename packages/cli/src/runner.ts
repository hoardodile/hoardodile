import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
	buildRegistry,
	createDirectoryContainer,
	createPluginHooks,
	createPluginResourceAPI,
	createProbeCache,
	HOOK_NAMES,
	type HookName,
	type PluginHooks,
	type PluginSandbox,
	type ResourceAPI,
} from "@hoardodile/host"
import { mediaProbes } from "@hoardodile/host/probe"
import {
	err,
	ok,
	type PluginManifest,
	type PluginManifestId,
	type Result,
} from "@hoardodile/sdk-types"
import { pluginManifest as pluginManifestSchema } from "@hoardodile/sdk-types/schema"

/** Exit codes: 0 pass, 1 regression, 2 error. */
export const EXIT_PASS = 0
export const EXIT_REGRESSION = 1
export const EXIT_ERROR = 2

export class CliError extends Error {}

/** Plugin hooks the CLI can run, in contract order (see {@link HOOK_NAMES}). */
export type CliHookName = HookName

/**
 * Fallback manifest for `--main`-only invocations (no manifest.json
 * next to the bundle). Capability gating then denies every permission —
 * use `--plugin-dir` to exercise gated hooks.
 */
const FALLBACK_ID: PluginManifestId = "00000000-0000-4000-8000-000000000000"

export type PluginTarget = {
	readonly id: PluginManifestId
	readonly manifest: PluginManifest
	readonly mainPath: string
	readonly dirPath: string
}

export function resolvePluginTarget(opts: {
	readonly main?: string
	readonly pluginDir?: string
}): PluginTarget {
	const dirPath =
		opts.pluginDir !== undefined
			? resolve(opts.pluginDir)
			: opts.main !== undefined
				? dirname(resolve(opts.main))
				: undefined
	if (dirPath === undefined) {
		throw new CliError("provide --plugin-dir <dir> or --main <main.js>")
	}
	const mainPath =
		opts.main !== undefined ? resolve(opts.main) : join(dirPath, "main.js")
	if (!existsSync(mainPath)) {
		throw new CliError(`plugin main.js not found: ${mainPath}`)
	}

	const manifestPath = join(dirPath, "manifest.json")
	let manifest: PluginManifest
	if (existsSync(manifestPath)) {
		const parsed = pluginManifestSchema.safeParse(
			JSON.parse(readFileSync(manifestPath, "utf-8")),
		)
		if (!parsed.success) {
			throw new CliError(
				`invalid manifest.json at ${manifestPath}: ${parsed.error.message}`,
			)
		}
		manifest = parsed.data
	} else {
		manifest = {
			id: FALLBACK_ID,
			name: "cli-plugin",
			description: "CLI-invoked plugin without a manifest.json",
			version: "0.0.0",
			permissions: {
				sourceMeta: false,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
			},
		}
	}
	return { id: manifest.id, manifest, mainPath, dirPath }
}

/**
 * One process-wide probe cache for the CLI: a hook that sniffs then
 * probes the same entry (or probes it repeatedly) resolves from memory
 * instead of re-reading the header — the same behaviour the server gets
 * from its per-resource cache. Scoped per directory so distinct
 * fixtures never collide.
 */
const cliProbeCache = createProbeCache()

/**
 * The {@link ResourceAPI} the CLI hands to hooks: a directory container
 * with the real probe implementations — identical to what the server
 * wires for its import path. `extractCacheDir` lets `extractArchive`
 * materialize archives next to the fixture during `plugin run`/`dev`.
 */
export function buildCliResourceAPI(
	dir: string,
	opts: { readonly extractCacheDir?: string } = {},
): ResourceAPI {
	return createPluginResourceAPI({
		view: createDirectoryContainer(dir),
		...mediaProbes,
		extractCacheDir: opts.extractCacheDir,
		probeCache: cliProbeCache,
		cacheScope: `cli:${dir}`,
	})
}

/**
 * The {@link ResourceAPI} over a resource's bare-file source folder —
 * the exact container the server reads in production, so a hook
 * captured against a real library behaves identically.
 */
export function buildArchiveResourceAPI(
	resourceDir: string,
	extractCacheDir?: string,
): ResourceAPI {
	return createPluginResourceAPI({
		view: createDirectoryContainer(resourceDir),
		...mediaProbes,
		extractCacheDir,
		probeCache: cliProbeCache,
		cacheScope: `cli:${resourceDir}`,
	})
}

/**
 * Single-plugin registry + hook facade over the worker sandbox. The
 * strategy layer (capability gating, error swallowing, result
 * validation) is exactly what the server runs.
 */
export async function createCliHooks(
	target: PluginTarget,
	sandbox: PluginSandbox,
): Promise<PluginHooks> {
	const plugin = await sandbox.loadPlugin({
		id: target.id,
		mainPath: target.mainPath,
		eager: true,
	})
	if (plugin === undefined) {
		throw new CliError(`plugin failed to load: ${target.mainPath}`)
	}
	const registry = buildRegistry([
		{
			id: target.id,
			manifest: target.manifest,
			enabled: true,
			priority: 0,
			pinned: false,
			color: "",
			missing: false,
			builtin: false,
			dev: false,
			plugin,
			diskPath: target.dirPath,
		},
	])
	return createPluginHooks({ getRegistry: () => registry })
}

export type HookOutcome = Result<
	{ readonly result: unknown; readonly durationMs: number },
	{ readonly result: string; readonly durationMs: number }
>

/**
 * Run one hook through the strategy facade. Errors are surfaced on
 * `ok:false` (the facade normally swallows them — `--in-process` raises
 * them instead for debugging).
 */
export async function runCliHook(opts: {
	readonly id: PluginManifestId
	readonly hooks: PluginHooks
	readonly hook: CliHookName
	readonly dir: string
	/** Writable dir for `extractArchive` materialization. */
	readonly extractCacheDir?: string
}): Promise<HookOutcome> {
	const api = buildCliResourceAPI(opts.dir, {
		extractCacheDir: opts.extractCacheDir,
	})
	const started = performance.now()
	let result: unknown
	try {
		switch (opts.hook) {
			case "detect":
				result = await opts.hooks.detectForPlugin(api, opts.id)
				break
			case "sourceMeta":
				result = (await opts.hooks.runMetaHooks(api, opts.id)).sourceMeta?.value
				break
			case "searchMeta":
				result = (await opts.hooks.runMetaHooks(api, opts.id)).searchMeta?.value
				break
			case "coverLocal":
				result = await opts.hooks.resolveLocalCoverSource(api, opts.id)
				break
			case "listFiles":
				result = await opts.hooks.buildFileList(api, opts.id)
				break
		}
	} catch (caught) {
		return err({
			result: caught instanceof Error ? caught.message : String(caught),
			durationMs: performance.now() - started,
		})
	}
	return ok({ result, durationMs: performance.now() - started })
}
