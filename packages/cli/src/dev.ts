import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, readFileSync, watch } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import type { ResourceAPI } from "@hoardodile/host"
import {
	captureHookSnapshot,
	formatHookSnapshot,
	type PluginHookSnapshot,
	resolveBuiltPluginTarget,
} from "./hook-snapshot.ts"
import { createRenderProviders } from "./render-providers.ts"
import {
	buildArchiveResourceAPI,
	buildCliResourceAPI,
	EXIT_ERROR,
	EXIT_PASS,
} from "./runner.ts"
import { openStorage, type StorageReader } from "./storage.ts"

/**
 * `hoardodile plugin dev` — the plugin development loop:
 *  1. build the plugin in watch mode (its own `watch` script, or this
 *     CLI's `plugin build --watch`),
 *  2. capture the server-side hook results from the real sandbox, so the
 *     workbench iframe gets the same `sourceMeta` / `searchMeta` /
 *     `fileStats` / file list the app would push,
 *  3. serve the published workbench with the plugin bundle, the resource
 *     data, and the same render pipeline the server uses for preview
 *     variants and video frames.
 *
 * Data comes either from a plain directory (`--data`, the default
 * `testdata/`) or from a real hoardodile library (`--storage`), which is
 * opened **read-only**: plugin writes land in the workbench's in-memory
 * mock, never in the user's database or archives.
 *
 * Long-running: stays up until SIGINT.
 */
export type DevOptions = {
	readonly pluginDir: string
	readonly dataDir?: string
	/** Real hoardodile storage root, opened read-only. */
	readonly storageDir?: string
	/** Resource to open first when serving a storage root. */
	readonly resId?: string
	readonly port: number
}

/** Debounce for rebuild-triggered recaptures; vite writes dist in bursts. */
const RECAPTURE_DEBOUNCE_MS = 300
const FIRST_BUILD_TIMEOUT_MS = 60_000
/** Resources listed in the picker; a library can hold thousands. */
const RESOURCE_LIST_LIMIT = 200
const DIRECTORY_RES_ID = "workbench"

function resolvePluginDir(value: string | undefined): string {
	const dir = resolve(value ?? ".")
	if (!existsSync(join(dir, "manifest.json"))) {
		throw new Error(
			`no manifest.json found in ${dir} — run this from a plugin directory or pass --plugin-dir`,
		)
	}
	return dir
}

function hasWatchScript(pluginDir: string): boolean {
	try {
		const pkg = JSON.parse(
			readFileSync(join(pluginDir, "package.json"), "utf8"),
		)
		return typeof pkg?.scripts?.watch === "string"
	} catch {
		return false
	}
}

/**
 * Load the workbench serve entry from the PLUGIN's own dependency tree.
 * The workbench is a dev tool, not part of the host runtime — the plugin
 * declares it as a devDependency (the template and scaffolder include it)
 * and `hoardodile plugin dev` serves that installed copy.
 */
async function loadWorkbenchServe(pluginDir: string) {
	const requireFromPlugin = createRequire(join(pluginDir, "package.json"))
	let workbenchEntry: string
	try {
		workbenchEntry = requireFromPlugin.resolve("@hoardodile/workbench")
	} catch {
		throw new Error(
			"@hoardodile/workbench not found in this plugin's dependencies — add it to devDependencies (the template and `create-hoardodile-plugin` include it) and run `pnpm install`.",
		)
	}
	return import(pathToFileURL(workbenchEntry).href)
}

function spawnWatcher(opts: {
	readonly command: string
	readonly args: readonly string[]
	readonly cwd: string
	readonly label: string
}): ChildProcess {
	console.log(`[hoardodile] starting ${opts.label}`)
	return spawn(opts.command, [...opts.args], {
		cwd: opts.cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
	})
}

function startBuildWatcher(pluginDir: string): ChildProcess {
	const watcher = hasWatchScript(pluginDir)
		? spawnWatcher({
				command: "pnpm",
				args: ["watch"],
				cwd: pluginDir,
				label: `\`pnpm watch\` in ${pluginDir}`,
			})
		: spawnWatcher({
				command: process.execPath,
				args: [process.argv[1] ?? "", "plugin", "build", "--watch"],
				cwd: pluginDir,
				label: "`plugin build --watch` (no watch script found)",
			})
	watcher.on("error", (err) => {
		console.error(`[hoardodile] build watcher failed: ${err.message}`)
		process.exitCode = EXIT_ERROR
	})
	watcher.on("exit", (code) => {
		if (code !== null && code !== 0) {
			console.error(`[hoardodile] build watcher exited with code ${code}`)
			process.exitCode = EXIT_ERROR
		}
	})
	return watcher
}

async function waitForBuild(
	distDir: string,
	timeoutMs: number,
): Promise<boolean> {
	const started = Date.now()
	while (Date.now() - started < timeoutMs) {
		if (existsSync(join(distDir, "main.js"))) return true
		await new Promise((r) => setTimeout(r, 500))
	}
	return false
}

/**
 * Where the workbench's resources come from. Both shapes answer the
 * same three questions — which resources exist, how to read one, and
 * what stored state a plugin would see — so everything downstream stays
 * unaware of whether it is looking at a directory or a real library.
 */
type ResourceSource = {
	readonly list: () => readonly {
		readonly id: string
		readonly name: string
		readonly contentPluginId?: string
	}[]
	readonly apiFor: (resId: string) => ResourceAPI | undefined
	readonly stateFor: (
		resId: string,
		pluginId: string,
	) => Record<string, unknown> | undefined
	/** Writable root for `extractArchive` materialization. */
	readonly extractCacheDir?: string
	readonly close?: () => void
}

function directorySource(
	dataDir: string,
	extractCacheDir?: string,
): ResourceSource {
	const api = buildCliResourceAPI(dataDir, { extractCacheDir })
	return {
		list: () => [{ id: DIRECTORY_RES_ID, name: "Workbench" }],
		apiFor: (resId) => (resId === DIRECTORY_RES_ID ? api : undefined),
		stateFor: () => undefined,
		extractCacheDir,
	}
}
function storageSource(
	storage: StorageReader,
	extractCacheDir?: string,
): ResourceSource {
	// One API per resource: archives are immutable, so the container and
	// its central-directory cache stay valid for the whole session.
	const apis = new Map<string, ResourceAPI | undefined>()
	return {
		list: () =>
			storage
				.listResources()
				.slice(0, RESOURCE_LIST_LIMIT)
				.map((resource) => ({
					id: resource.id,
					name: resource.name,
					contentPluginId: resource.contentPluginId,
				})),
		apiFor(resId) {
			if (apis.has(resId)) return apis.get(resId)
			const resource = storage.findResource(resId)
			const archive =
				resource === undefined ? undefined : storage.archivePath(resource)
			const api =
				archive !== undefined && existsSync(archive)
					? buildArchiveResourceAPI(archive, extractCacheDir)
					: undefined
			if (api === undefined && resource !== undefined) {
				console.warn(`[hoardodile] no source archive for resource ${resId}`)
			}
			apis.set(resId, api)
			return api
		},
		stateFor: (resId, pluginId) => storage.readState(resId, pluginId),
		extractCacheDir,
		close: () => storage.close(),
	}
}

/**
 * Holds the latest sandboxed hook results per resource. Recaptures are
 * serialised and coalesced: a rebuild burst must not spawn a worker per
 * written file, and two overlapping captures would race for the slot.
 */
function createSnapshotStore(opts: {
	readonly pluginDir: string
	readonly source: ResourceSource
}) {
	const snapshots = new Map<string, PluginHookSnapshot>()
	const running = new Map<string, Promise<void>>()

	async function capture(resId: string): Promise<void> {
		const api = opts.source.apiFor(resId)
		if (api === undefined) return
		try {
			const target = resolveBuiltPluginTarget(opts.pluginDir)
			const snapshot = await captureHookSnapshot({ target, api })
			snapshots.set(resId, snapshot)
			console.log(`[hoardodile] ${resId}: ${formatHookSnapshot(snapshot)}`)
			if (!snapshot.detect.ok) {
				console.error(
					"[hoardodile] detect failed — the plugin may not match this resource.",
				)
			}
		} catch (err) {
			console.error(
				`[hoardodile] hook snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	function refresh(resId: string): Promise<void> {
		const inFlight = running.get(resId)
		if (inFlight !== undefined) return inFlight
		const run = capture(resId).finally(() => running.delete(resId))
		running.set(resId, run)
		return run
	}

	return {
		/** Capture on demand, then serve the cached result. */
		async read(resId: string): Promise<PluginHookSnapshot | undefined> {
			if (!snapshots.has(resId)) await refresh(resId)
			return snapshots.get(resId)
		},
		/** Drop every capture so the next read re-runs against the new build. */
		invalidate(): void {
			snapshots.clear()
		},
		captured: () => [...snapshots.keys()],
		refresh,
	}
}

/** Recapture whenever the watcher rewrites the bundle. */
function watchDistForRebuilds(
	distDir: string,
	onRebuild: () => void,
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	const watcher = watch(distDir, () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = setTimeout(onRebuild, RECAPTURE_DEBOUNCE_MS)
	})
	return () => {
		if (timer !== undefined) clearTimeout(timer)
		watcher.close()
	}
}

/** Resolve the data source from the flags, preferring a real library. */
function resolveSource(
	opts: DevOptions & { readonly pluginDir: string },
): ResourceSource | undefined {
	const extractCacheDir = join(opts.pluginDir, ".hoardodile", "extract")
	if (opts.storageDir !== undefined) {
		const root = resolve(opts.storageDir)
		const storage = openStorage(root)
		const count = storage.listResources().length
		console.log(`[hoardodile] storage: ${root} (${count} resources, read-only)`)
		return storageSource(storage, extractCacheDir)
	}
	const dataDir =
		opts.dataDir !== undefined
			? resolve(opts.dataDir)
			: join(resolve(opts.pluginDir ?? "."), "testdata")
	if (!existsSync(dataDir)) {
		console.warn(
			`[hoardodile] no data dir found at ${dataDir} — mount one with --data (or --storage <hoardodile-root>).`,
		)
		return undefined
	}
	console.log(`[hoardodile] data: ${dataDir}`)
	return directorySource(dataDir, extractCacheDir)
}

export async function executeDev(opts: DevOptions): Promise<number> {
	const pluginDir = resolvePluginDir(opts.pluginDir)
	const distDir = join(pluginDir, "dist")
	const source = resolveSource({ ...opts, pluginDir })
	const target = existsSync(join(distDir, "main.js"))
		? resolveBuiltPluginTarget(pluginDir)
		: undefined

	const watcher = startBuildWatcher(pluginDir)
	const snapshots =
		source === undefined
			? undefined
			: createSnapshotStore({ pluginDir, source })

	const render =
		source === undefined
			? undefined
			: createRenderProviders({
					resolveApi: async (resId) => source.apiFor(resId),
					// The plugin's coverLocal pick is captured in the hook
					// snapshot; the cover render feeds the workbench picker.
					resolveCoverSource: async (resId) =>
						(await snapshots?.read(resId))?.coverLocal,
					// Rendered artifacts live with the plugin, never inside
					// the user's storage root.
					cacheDir: join(pluginDir, ".hoardodile", "cache"),
				})

	// The workbench mounts the BUILT bundle: `hoardodile plugin build`
	// emits manifest.json, index.html and main.js into dist/. Serving the
	// source root instead would hand the iframe raw .tsx.
	const { serveWorkbench } = await loadWorkbenchServe(pluginDir)
	const server = await serveWorkbench({
		pluginDir: distDir,
		port: opts.port,
		// User-consented dev downloads land in the plugin's own scratch
		// vault, next to the extraction cache — never in the read-only
		// storage root or the data dir.
		vaultRoot: join(pluginDir, ".hoardodile", "vault"),
		providers: {
			resources: () => source?.list() ?? [],
			files: source === undefined ? undefined : createFileProvider(source),
			snapshot: (resId: string) => snapshots?.read(resId),
			state: (resId: string) =>
				source?.stateFor(resId, target?.id ?? "") as
					| Record<string, unknown>
					| undefined,
			preview: render?.preview,
			frame: render?.frame,
			cover: render?.cover,
		},
	})

	let stopDistWatch: (() => void) | undefined
	if (await waitForBuild(distDir, FIRST_BUILD_TIMEOUT_MS)) {
		const first = opts.resId ?? source?.list()[0]?.id
		if (first !== undefined) await snapshots?.refresh(first)
		stopDistWatch = watchDistForRebuilds(distDir, () => {
			// Rebuilt bundle: drop every capture and re-run the ones the
			// page has already asked for, so a reload shows the new build.
			const captured = snapshots?.captured() ?? []
			snapshots?.invalidate()
			for (const resId of captured) void snapshots?.refresh(resId)
		})
	} else {
		console.error(
			"[hoardodile] no dist/main.js appeared within 60s — is the build working?",
		)
	}

	await new Promise<void>((resolveStop) => {
		const stop = () => {
			stopDistWatch?.()
			watcher.kill()
			source?.close?.()
			server.close(() => resolveStop())
		}
		process.once("SIGINT", stop)
		process.once("SIGTERM", stop)
	})
	return EXIT_PASS
}

/** File access for the workbench, backed by the resource's own view. */
function createFileProvider(source: ResourceSource) {
	return {
		async list(resId: string): Promise<readonly string[]> {
			return (await source.apiFor(resId)?.listFileNames()) ?? []
		},
		async stat(resId: string, path: string) {
			return source.apiFor(resId)?.statFile(path)
		},
		async read(resId: string, path: string): Promise<Uint8Array | undefined> {
			try {
				return await source.apiFor(resId)?.readFile(path)
			} catch {
				return undefined
			}
		},
		async extracted(
			_path: string,
			path: string,
		): Promise<Uint8Array | undefined> {
			const root = source.extractCacheDir
			if (root === undefined) return undefined
			const abs = resolve(root, path)
			if (abs !== resolve(root) && !abs.startsWith(resolve(root) + sep)) {
				return undefined
			}
			try {
				return readFileSync(abs)
			} catch {
				return undefined
			}
		},
	}
}
