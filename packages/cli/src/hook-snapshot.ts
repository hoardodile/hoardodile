import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	type PluginHooks,
	type ResourceAPI,
} from "@hoardodile/host"
import type { FileStats, PluginManifest } from "@hoardodile/sdk-types"
import { pluginManifest as pluginManifestSchema } from "@hoardodile/sdk-types/schema"
import type { PluginTarget } from "./runner.ts"
import { CliError, createCliHooks } from "./runner.ts"

/**
 * The server-side hook results the iframe needs to render exactly like
 * production: the host pushes `sourceMeta`, `searchMeta` and `fileStats`
 * into the plugin context, and answers `listFiles` with the plugin's own
 * hook output. `hoardodile plugin dev` captures them from the real
 * sandbox so the workbench is a faithful stand-in for the app.
 *
 * `errors` records hooks that threw; the facade swallows failures, so
 * without this a broken hook is indistinguishable from an absent one.
 */
export type PluginHookSnapshot = {
	readonly pluginId: string
	readonly detect: {
		readonly ok: boolean
		readonly reasons?: readonly string[]
	}
	readonly sourceMeta: unknown
	readonly searchMeta: unknown
	readonly coverLocal: string | undefined
	readonly files: readonly unknown[] | undefined
	readonly fileStats: FileStats
	readonly imageHashes?: readonly unknown[]
	readonly errors: Readonly<Record<string, string>>
	readonly capturedAt: number
}

/**
 * The snapshot's detect entry: `ok` plus the miss reasons only. A
 * successful match may carry a schema payload (flowed to hooks via
 * `api.context`) that the workbench never consumes — keeping it out of
 * the snapshot avoids serializing plugin classifications the mock host
 * has no use for.
 */
export function snapshotDetect(detection: {
	readonly ok: boolean
	readonly reasons?: readonly string[]
}): PluginHookSnapshot["detect"] {
	return detection.ok ? { ok: true } : { ok: false, reasons: detection.reasons }
}

/**
 * Assemble the plugin target for a source directory: the manifest is
 * authored next to `src/`, the bundle lands in `dist/`.
 * `resolvePluginTarget` only understands a single base dir, hence the
 * dedicated resolver here.
 */
export function resolveBuiltPluginTarget(pluginDir: string): PluginTarget {
	const manifestPath = join(pluginDir, "manifest.json")
	if (!existsSync(manifestPath)) {
		throw new CliError(`no manifest.json found in ${pluginDir}`)
	}
	const mainPath = join(pluginDir, "dist", "main.js")
	if (!existsSync(mainPath)) {
		throw new CliError(`plugin bundle not built: ${mainPath}`)
	}
	const manifest: PluginManifest = pluginManifestSchema.parse(
		JSON.parse(readFileSync(manifestPath, "utf8")),
	)
	return { id: manifest.id, manifest, mainPath, dirPath: pluginDir }
}

/**
 * Run the plugin's server-side hooks against `api` through a throwaway
 * sandbox and collect the results. A fresh sandbox per capture is what
 * makes watch rebuilds visible: the worker caches the module graph it
 * loaded, so reusing one would keep serving the stale bundle.
 */
export async function captureHookSnapshot(opts: {
	readonly target: PluginTarget
	/** Resource view the hooks read (a directory-backed ResourceAPI). */
	readonly api: ResourceAPI
}): Promise<PluginHookSnapshot> {
	const { target, api } = opts
	const sandbox = createPluginSandbox(DEFAULT_SANDBOX_CONFIG)
	try {
		const hooks = await createCliHooks(target, sandbox)
		return await collectHookResults({ target, api, hooks })
	} finally {
		await sandbox.disposeAll()
	}
}

async function collectHookResults(opts: {
	readonly target: PluginTarget
	readonly api: ResourceAPI
	readonly hooks: PluginHooks
}): Promise<PluginHookSnapshot> {
	const { target, api, hooks } = opts
	const errors: Record<string, string> = {}

	async function attempt<T>(
		hook: string,
		run: () => Promise<T>,
	): Promise<T | undefined> {
		try {
			return await run()
		} catch (err) {
			errors[hook] = err instanceof Error ? err.message : String(err)
			return undefined
		}
	}

	const detect = snapshotDetect(
		(await attempt("detect", () => hooks.detectForPlugin(api, target.id))) ?? {
			ok: false,
			reasons: ["detect threw an exception"],
		},
	)
	const meta = await attempt("meta", () => hooks.runMetaHooks(api, target.id))
	const files = await attempt("listFiles", () =>
		hooks.buildFileList(api, target.id),
	)
	const coverLocal = await attempt("coverLocal", () =>
		hooks.resolveLocalCoverSource(api, target.id),
	)
	// Hash rows are what the app's duplicate/similar sections are built
	// from, so the workbench surfaces the count too.
	const hashes = hooks.supportsImageHashes(target.id)
		? await attempt("imageHashes", () => hooks.runImageHashes(api, target.id))
		: undefined
	const fileStats =
		(await attempt("fileStats", () => measureFileStats(api))) ?? {}

	return {
		pluginId: target.id,
		detect,
		sourceMeta: meta?.sourceMeta?.value,
		searchMeta: meta?.searchMeta?.value,
		coverLocal,
		files,
		fileStats,
		imageHashes: hashes?.hashes,
		errors,
		capturedAt: Date.now(),
	}
}

/**
 * File count and total byte size of the resource, mirroring what the
 * server records on import and pushes to the iframe as `fileStats`.
 */
async function measureFileStats(api: ResourceAPI): Promise<FileStats> {
	const names = await api.listFileNames()
	const stats = await api.statFiles(names)
	let sizeBytes = 0
	for (const stat of stats) sizeBytes += stat?.sizeBytes ?? 0
	return { count: names.length, sizeBytes }
}

/** One-line human summary for the dev server log. */
export function formatHookSnapshot(snapshot: PluginHookSnapshot): string {
	const parts = [
		snapshot.detect.ok
			? "detect ok"
			: `detect miss (${(snapshot.detect.reasons ?? []).join(", ")})`,
		`${snapshot.fileStats.count ?? 0} files`,
	]
	if (snapshot.files !== undefined) {
		parts.push(`listFiles ${snapshot.files.length}`)
	}
	if (snapshot.sourceMeta !== undefined) parts.push("sourceMeta")
	if (snapshot.searchMeta !== undefined) parts.push("searchMeta")
	if (snapshot.coverLocal !== undefined) {
		parts.push(`cover ${snapshot.coverLocal}`)
	}
	for (const [hook, message] of Object.entries(snapshot.errors)) {
		parts.push(`${hook} failed: ${message}`)
	}
	return parts.join(" · ")
}
