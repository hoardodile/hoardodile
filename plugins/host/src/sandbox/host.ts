import { type ChildProcess, fork, spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type {
	PluginAssetDeleteResult,
	PluginDownloadRequest,
	PluginDownloadResult,
	PluginPermissions,
} from "@hoardodile/sdk-types"
import { CAPABILITY_BY_METHOD } from "@hoardodile/sdk-types/plugin-capabilities"
import type { PluginDefinition, ResourceAPI } from "../types.ts"
import { createCallTimers, type PendingCall } from "./call-timers.ts"
import {
	API_METHOD_NAMES,
	type ApiMethodName,
	deserializeError,
	type HookName,
	type InvokeRequest,
	LOG_METHOD_NAMES,
	type SerializedError,
	serializeError,
	type WorkerMessage,
} from "./protocol.ts"
import { createSandboxedPlugin } from "./sandboxed-plugin.ts"

/**
 * The plugin asset handler: the host-side implementation of the
 * `download`/`statAsset`/`readAsset`/`deleteAsset` ResourceAPI methods,
 * bound to the plugin id (the sandbox knows which plugin issued the
 * call). Wired by the app server; hosts without a consent channel (CLI,
 * workbench) omit it and the methods answer `UNAVAILABLE`.
 */
export type PluginAssetHandler = {
	readonly download: (
		pluginId: string,
		request: PluginDownloadRequest,
	) => Promise<PluginDownloadResult>
	readonly statAsset: (
		pluginId: string,
		path: string,
	) => Promise<{ readonly sizeBytes: number } | undefined>
	readonly readAsset: (pluginId: string, path: string) => Promise<Uint8Array>
	readonly deleteAsset: (
		pluginId: string,
		path: string,
	) => Promise<PluginAssetDeleteResult>
}

/**
 * Kill a plugin sandbox process when an invocation neither returns nor
 * shows resource-API activity for this long. Hooks that keep calling the
 * API reset the watchdog continuously and never trip it; time spent inside
 * a host-side API call does not count as inactivity.
 */
export const PLUGIN_WATCHDOG_TIMEOUT_MS = 60_000

/** Absolute cap for a single plugin hook invocation, regardless of activity. */
export const PLUGIN_HOOK_HARD_TIMEOUT_MS = 30 * 60_000

/** V8 old-generation memory cap per plugin sandbox process, in MiB. */
export const PLUGIN_WORKER_MAX_OLD_SPACE_MB = 512

/**
 * Absolute cap for one hook result crossing the IPC boundary back to the
 * host. Exceeding it turns the hook into an error instead of letting a
 * hostile bundle clone a giant payload into the host process.
 */
export const PLUGIN_MAX_RESULT_BYTES = 256 * 1024 * 1024

/** Cap on `log*` messages per hook invocation (see {@link PluginSandboxConfig}). */
export const PLUGIN_MAX_LOGS_PER_HOOK = 1_000

/** Cap on ResourceAPI calls per hook invocation (see {@link PluginSandboxConfig}). */
export const PLUGIN_MAX_API_CALLS_PER_HOOK = 100_000

/**
 * Sandbox-gated ResourceAPI methods, read from the single capability
 * table (`@hoardodile/sdk-types/plugin-capabilities`) — a permission
 * declared there is enforced here automatically, and a sandbox method
 * listed there but not declared by the manifest is denied with the
 * capability's own name.
 *
 * The asset surface (the `download` capability) is additionally
 * intercepted before touching the ResourceAPI instance: its
 * implementation comes from the wired {@link PluginAssetHandler}, which
 * knows the owning plugin id.
 */
const ASSET_METHODS = new Set<ApiMethodName>([
	"download",
	"statAsset",
	"readAsset",
	"deleteAsset",
])

/**
 * Max sandbox spawns per plugin within {@link PLUGIN_WORKER_RESPAWN_WINDOW_MS}
 * before the plugin is degraded. It recovers automatically once the crash
 * window slides clean, or immediately on disable/rescan.
 */
export const PLUGIN_WORKER_MAX_RESPAWNS = 3

/** Sliding window for {@link PLUGIN_WORKER_MAX_RESPAWNS}. */
export const PLUGIN_WORKER_RESPAWN_WINDOW_MS = 60_000

export type PluginSandboxConfig = {
	/**
	 * Kill the sandbox process when an invocation neither returns nor shows
	 * API activity for this long. Long-running hooks that keep calling the
	 * resource API reset the watchdog continuously and never trip it;
	 * time spent inside a host-side API call does not count as inactivity.
	 */
	readonly watchdogMs: number
	/** Absolute per-invocation cap, regardless of activity. */
	readonly hardTimeoutMs: number
	/** V8 old-generation cap per sandbox process; exceeding it aborts it. */
	readonly maxOldSpaceMb: number
	/**
	 * Max sandbox spawns per plugin within {@link respawnWindowMs} before the
	 * plugin is degraded (all invocations reject). The plugin recovers
	 * automatically once the crash window slides clean; `unloadPlugin`
	 * (disable or rescan) resets the budget immediately.
	 */
	readonly maxRespawns: number
	readonly respawnWindowMs: number
	/** Absolute cap for one hook result returning to the host. */
	readonly maxResultBytes: number
	/**
	 * Cap on `log*` messages per hook invocation; exceeding it fails the
	 * hook (log messages reset the watchdog, so a log flood would
	 * otherwise stay alive until the hard timeout).
	 */
	readonly maxLogsPerHook: number
	/**
	 * Cap on ResourceAPI calls per hook invocation; exceeding it fails the
	 * hook. Sized generously so large per-file scans (hashBytes over tens
	 * of thousands of files) keep working — the cap bounds a runaway RPC
	 * fan-out that would otherwise pin the host's CPU.
	 */
	readonly maxApiCallsPerHook: number
	/**
	 * Permission-model flag to pass to the sandbox child, or `undefined` to
	 * probe the running Node for the first accepted name. Tests override
	 * this to exercise the fail-closed path.
	 */
	readonly permissionFlag?: string
	/**
	 * Host-managed plugin vault directory (`<plugin-dir>/vault/`, or the
	 * versioned-storage vault for dev plugins). When set, the child gets
	 * an extra fs-read grant and the module policy gate allows loading
	 * files from it — downloaded runtimes (JS/WASM) importable from the
	 * vault are the point of the asset API. A function form lets one
	 * shared sandbox resolve the path per plugin (disk vs dev plugins
	 * store their vault differently).
	 */
	readonly assetVaultDir?: string | ((pluginId: string) => string | undefined)
	/**
	 * Plugin asset handler wired by the app server. Absent → the asset
	 * methods answer `UNAVAILABLE` (CLI, workbench, tests without a
	 * consent channel).
	 */
	readonly pluginAssets?: PluginAssetHandler
}

export const DEFAULT_SANDBOX_CONFIG: PluginSandboxConfig = {
	watchdogMs: PLUGIN_WATCHDOG_TIMEOUT_MS,
	hardTimeoutMs: PLUGIN_HOOK_HARD_TIMEOUT_MS,
	maxOldSpaceMb: PLUGIN_WORKER_MAX_OLD_SPACE_MB,
	maxRespawns: PLUGIN_WORKER_MAX_RESPAWNS,
	respawnWindowMs: PLUGIN_WORKER_RESPAWN_WINDOW_MS,
	maxResultBytes: PLUGIN_MAX_RESULT_BYTES,
	maxLogsPerHook: PLUGIN_MAX_LOGS_PER_HOOK,
	maxApiCallsPerHook: PLUGIN_MAX_API_CALLS_PER_HOOK,
}

export type PluginSandbox = {
	/**
	 * Register and load a plugin bundle. With `eager` the sandbox process
	 * stays alive; without it the hook list is probed and the process
	 * immediately idles (it respawns lazily on first invocation — disabled
	 * plugins still serve their bound resources without holding a process).
	 *
	 * Reloading an already-registered id keeps the previous process alive
	 * until the new bundle loads successfully — a failed reload returns
	 * the previous definition instead of stranding a disposed registry.
	 *
	 * Returns `undefined` when the bundle cannot be loaded and there is no
	 * previous definition to fall back on (already logged) — callers fall
	 * back to a failing plugin.
	 */
	readonly loadPlugin: (opts: {
		readonly id: string
		readonly mainPath: string
		readonly eager: boolean
		/**
		 * Manifest permissions the sandbox enforces on every API call
		 * (e.g. the `container` gate). Absent keys count as denied here,
		 * so a caller that omits this opts into the strictest view.
		 */
		readonly permissions?: PluginPermissions
	}) => Promise<PluginDefinition | undefined>
	/**
	 * Terminate the plugin's sandbox process (if any) and reset its respawn
	 * budget. The hook list stays known; the next invocation lazily respawns.
	 */
	readonly unloadPlugin: (id: string) => void
	/**
	 * Terminate and forget every plugin whose id is not in `keepIds`.
	 * Registered ids keep their processes — used by the loader after a
	 * successful reload to free plugins that left the registry.
	 */
	readonly disposeExcept: (keepIds: ReadonlySet<string>) => Promise<void>
	/** Terminate every process and forget all plugins. Pending invocations reject. */
	readonly disposeAll: () => Promise<void>
}

type LoadWaiter = {
	readonly resolve: () => void
	readonly reject: (err: Error) => void
}

type PluginState = {
	readonly id: string
	readonly mainPath: string
	readonly permissions: PluginPermissions | undefined
	child: ChildProcess | undefined
	hooks: readonly HookName[] | undefined
	loading: Promise<void> | undefined
	loadWaiter: LoadWaiter | undefined
	readonly pending: Map<number, PendingCall>
	respawnTimes: number[]
	degraded: boolean
	disposed: boolean
}

/**
 * Flag names the Node permission model accepted over its life: it was
 * introduced as `--experimental-permission` and stabilized under
 * `--permission`. Probe the running binary once and reuse the verdict.
 */
const PERMISSION_FLAG_CANDIDATES = ["--permission", "--experimental-permission"]

let permissionFlagPromise: Promise<string | undefined> | undefined

async function resolvePermissionFlag(): Promise<string | undefined> {
	permissionFlagPromise ??= probePermissionFlag()
	return permissionFlagPromise
}

/**
 * Spawn a probe child for each candidate flag name and keep the first one
 * the runtime accepts. A flag the runtime does not know makes `node` exit
 * non-zero before running the script, so an `exit 0` verdict is the proof.
 */
async function probePermissionFlag(): Promise<string | undefined> {
	for (const flag of PERMISSION_FLAG_CANDIDATES) {
		if (await acceptsFlag(flag)) return flag
	}
	return undefined
}

function acceptsFlag(flag: string): Promise<boolean> {
	return new Promise((resolveProbe) => {
		const probe = spawn(
			process.execPath,
			[flag, `--allow-fs-read=${tmpdir()}`, "-e", "process.exit(0)"],
			{ stdio: "ignore", timeout: 10_000 },
		)
		probe.on("exit", (code) => resolveProbe(code === 0))
		probe.on("error", () => resolveProbe(false))
	})
}

export function createPluginSandbox(
	config: PluginSandboxConfig = DEFAULT_SANDBOX_CONFIG,
): PluginSandbox {
	const states = new Map<string, PluginState>()
	let nextCallId = 1
	const timers = createCallTimers({
		watchdogMs: config.watchdogMs,
		hardTimeoutMs: config.hardTimeoutMs,
	})

	async function loadPlugin(opts: {
		id: string
		mainPath: string
		eager: boolean
		permissions?: PluginPermissions
	}): Promise<PluginDefinition | undefined> {
		const previous = states.get(opts.id)
		const state: PluginState = {
			id: opts.id,
			mainPath: opts.mainPath,
			permissions: opts.permissions,
			child: undefined,
			hooks: undefined,
			loading: undefined,
			loadWaiter: undefined,
			pending: new Map(),
			respawnTimes: [],
			degraded: false,
			disposed: false,
		}
		states.set(opts.id, state)
		try {
			await ensureLoaded(state)
		} catch (err) {
			console.error(`[plugin-sandbox] ${opts.id}: failed to load main.js`, err)
			state.disposed = true
			// A concurrent loadPlugin for the same id may have replaced this
			// state — only act when the map still owns it.
			if (states.get(opts.id) !== state) return undefined
			if (previous !== undefined) {
				// The previous process never stopped being healthy — restore
				// it so a failed reload can't strand a disposed registry.
				previous.disposed = false
				states.set(opts.id, previous)
				return createSandboxedPlugin(
					previous.hooks ?? ["detect"],
					(hook, api) => invoke(previous, hook, api),
				)
			}
			states.delete(opts.id)
			return undefined
		}
		// The new bundle loaded: retire the previous process only now —
		// in-flight invocations against it settle normally, and a failed
		// reload above never killed it in the first place.
		if (previous !== undefined) {
			previous.disposed = true
			await teardownChild(previous)
		}
		if (!opts.eager) {
			void teardownChild(state)
		}
		return createSandboxedPlugin(state.hooks ?? ["detect"], (hook, api) =>
			invoke(state, hook, api),
		)
	}

	function unloadPlugin(id: string): void {
		const state = states.get(id)
		if (state === undefined) return
		teardownChild(state)
		state.respawnTimes = []
		state.degraded = false
	}

	async function disposeAll(): Promise<void> {
		const tasks: Promise<void>[] = []
		for (const state of states.values()) {
			state.disposed = true
			tasks.push(teardownChild(state))
		}
		states.clear()
		await Promise.all(tasks)
	}

	async function disposeExcept(keepIds: ReadonlySet<string>): Promise<void> {
		const tasks: Promise<void>[] = []
		for (const [id, state] of states) {
			if (keepIds.has(id)) continue
			state.disposed = true
			states.delete(id)
			tasks.push(teardownChild(state))
		}
		await Promise.all(tasks)
	}

	// -- child lifecycle --

	/**
	 * Keep the sandbox child referenced only while it has work pending
	 * (loading or an in-flight invocation); idle children must not hold
	 * the host process open, but an unref'd child in a host with nothing
	 * else running (one-shot CLI, dist smoke) would otherwise let the
	 * process exit before a slow sandbox boot answered.
	 */
	function syncRef(state: PluginState): void {
		const child = state.child
		if (child === undefined) return
		if (
			state.loading !== undefined ||
			state.loadWaiter !== undefined ||
			state.pending.size > 0
		) {
			child.ref()
		} else {
			child.unref()
		}
	}

	function ensureLoaded(state: PluginState): Promise<void> {
		if (state.child !== undefined) return Promise.resolve()
		state.loading ??= spawnAndLoad(state).finally(() => {
			state.loading = undefined
		})
		return state.loading
	}

	async function spawnAndLoad(state: PluginState): Promise<void> {
		const now = Date.now()
		state.respawnTimes = state.respawnTimes.filter(
			(t) => now - t < config.respawnWindowMs,
		)
		if (state.respawnTimes.length >= config.maxRespawns) {
			state.degraded = true
			throw new Error(
				`plugin ${state.id} unavailable: sandbox respawned ${config.maxRespawns} times within ${config.respawnWindowMs}ms`,
			)
		}
		state.respawnTimes.push(now)

		const permissionFlag =
			config.permissionFlag ?? (await resolvePermissionFlag())
		if (permissionFlag === undefined) {
			throw new Error(
				`plugin ${state.id} unavailable: this Node build has no permission-model flag (tried ${PERMISSION_FLAG_CANDIDATES.map((f) => `"${f}"`).join(", ")}); refusing to run plugin code unsandboxed`,
			)
		}

		// Resolve the sandbox entry through the package's own exports map
		// (`@hoardodile/host/worker-entry`) when that package is installed.
		// The sandbox module also gets inlined into the server bundle, where
		// there is no `@hoardodile/host` on disk — then we fall back to
		// `dist/chunks/worker-entry.mjs` next to the emitting chunk.
		// Kept out of a `new URL()` literal so Vite does not detect a browser
		// worker here: it would bundle worker-entry.mjs with node: builtins
		// shimmed out and rewrite the URL to an unusable /assets/ path. The
		// entry ships untransformed and must run as plain ESM in a child
		// process.
		const entryPath = fileURLToPath(resolveWorkerEntryUrl())
		const pluginDir = dirname(state.mainPath)
		// The ESM loader passes every module path through realpathSync under
		// `--permission`, so the grants must use the canonical on-disk form —
		// a plugin dir reached through a symlink (macOS `/tmp`→`/private/tmp`,
		// WSL paths, junctions) would otherwise resolve outside its own grant
		// and fail to load with ERR_ACCESS_DENIED.
		const realEntryPath = realPathOrResolve(entryPath)
		const realPluginDir = realPathOrResolve(pluginDir)
		const realMainPath = realPathOrResolve(state.mainPath)

		// The child's grants are minimal: one fs-read allowlist (its own
		// directory, plus the entry file it must load, plus the host-managed
		// asset vault when one is wired), a memory cap, and nothing else —
		// no fs write, no child processes, no worker threads, no native
		// addons. The module policy hook (registered inside the entry via
		// `registerHooks`) closes the remaining surface: nothing outside the
		// plugin directory (and the vault) and no `node:` builtins except
		// `node:url` can be imported.
		const fsReadGrants = [`${realPluginDir}${sep}`, realEntryPath]
		const assetVaultDir =
			typeof config.assetVaultDir === "function"
				? config.assetVaultDir(state.id)
				: config.assetVaultDir
		const realVaultDir =
			assetVaultDir === undefined ? undefined : realPathOrResolve(assetVaultDir)
		if (realVaultDir !== undefined) {
			fsReadGrants.push(`${realVaultDir}${sep}`)
		}
		const child = fork(
			realEntryPath,
			[realPluginDir, realEntryPath, realVaultDir].filter(
				(v): v is string => v !== undefined,
			),
			{
				execArgv: [
					permissionFlag,
					...fsReadGrants.map((p) => `--allow-fs-read=${p}`),
					`--max-old-space-size=${config.maxOldSpaceMb}`,
				],
				serialization: "advanced",
				// Child stderr is inherited (self-check failures must surface);
				// plugin console output is dropped — logs flow over the RPC.
				stdio: ["ignore", "ignore", "inherit", "ipc"],
				env: {
					...process.env,
					HOARDODILE_PLUGIN_MAX_RESULT_BYTES: String(config.maxResultBytes),
					HOARDODILE_PLUGIN_MAX_LOGS_PER_HOOK: String(config.maxLogsPerHook),
					HOARDODILE_PLUGIN_MAX_API_CALLS_PER_HOOK: String(
						config.maxApiCallsPerHook,
					),
				},
			},
		)
		// The sandbox must never hold the process open on its own — but
		// while a load/invocation is pending the child is referenced (see
		// syncRef) so a short-lived host cannot exit mid-boot.
		child.unref()
		state.child = child
		syncRef(state)

		child.on("message", (msg: WorkerMessage) =>
			handleMessage(state, child, msg),
		)
		child.on("error", (err: unknown) => failChild(state, child, asError(err)))
		child.on("exit", (code) => {
			if (state.child === child) {
				failChild(
					state,
					child,
					new Error(`plugin ${state.id} worker exited (code ${code})`),
				)
			}
		})

		const loaded = new Promise<void>((resolveLoaded, reject) => {
			state.loadWaiter = { resolve: resolveLoaded, reject }
		})
		try {
			child.send({ type: "load", mainPath: realMainPath } satisfies {
				type: "load"
				mainPath: string
			})
		} catch (err) {
			// The channel never opened (spawn failed hard) — the waiter
			// would hang forever; tear the child down and fail the load.
			await teardownChild(state, asError(err))
			throw err
		}
		try {
			await loaded
		} catch (err) {
			// A plugin whose main.js throws at import reports `loaded: ok:false`
			// and keeps idling — terminate the child so it never outlives
			// its owning state (failChild already covered error/exit).
			await teardownChild(state)
			throw err
		} finally {
			state.loadWaiter = undefined
		}
		// Loaded and (for eager plugins) alive: an idle sandbox must not
		// hold the host open, but it stays referenced while invocations
		// are in flight.
		syncRef(state)
	}

	/**
	 * Terminate the child without touching the respawn budget. Rejects
	 * the load waiter and every pending call with `err` (or the standard
	 * "worker stopped" error) and clears the child slot; a no-op when
	 * there is no child.
	 */
	function teardownChild(state: PluginState, err?: Error): Promise<void> {
		const child = state.child
		state.child = undefined
		state.loading = undefined
		const stopErr = err ?? new Error(`plugin ${state.id} worker stopped`)
		state.loadWaiter?.reject(stopErr)
		state.loadWaiter = undefined
		rejectAllPending(state, stopErr)
		if (child === undefined) return Promise.resolve()
		// SIGTERM on POSIX, TerminateProcess on Windows. Pending calls were
		// already rejected; stale messages can no longer resolve anything
		// because the slot is cleared.
		child.kill()
		return Promise.resolve()
	}

	function failChild(
		state: PluginState,
		child: ChildProcess,
		err: Error,
	): void {
		if (state.child !== child) return // stale event from a replaced child
		void teardownChild(state, err)
	}

	function rejectAllPending(state: PluginState, err: Error): void {
		for (const call of state.pending.values()) {
			timers.clearCallTimers(call)
			call.reject(err)
		}
		state.pending.clear()
	}

	// -- invocation --

	async function invoke(
		state: PluginState,
		hook: HookName,
		api: ResourceAPI,
	): Promise<unknown> {
		if (state.disposed) {
			throw new Error(`plugin ${state.id} sandbox disposed`)
		}
		if (state.degraded) {
			// Auto-recover once every crash in the budget has aged out of the
			// respawn window — spawnAndLoad would accept a spawn again anyway.
			const now = Date.now()
			state.respawnTimes = state.respawnTimes.filter(
				(t) => now - t < config.respawnWindowMs,
			)
			if (state.respawnTimes.length === 0) {
				state.degraded = false
			} else {
				throw new Error(
					`plugin ${state.id} unavailable: sandbox crashed repeatedly`,
				)
			}
		}
		await ensureLoaded(state)
		const child = state.child
		if (child === undefined) {
			throw new Error(`plugin ${state.id} sandbox unavailable`)
		}

		const callId = nextCallId++
		return new Promise((resolveCall, reject) => {
			const call: PendingCall = {
				api,
				resolve: resolveCall,
				reject,
				apiInFlight: 0,
			}
			state.pending.set(callId, call)
			syncRef(state)
			timers.armWatchdog(
				call,
				failCall(
					state,
					child,
					callId,
					`hung: no activity for ${config.watchdogMs}ms`,
				),
			)
			timers.armHardTimer(
				call,
				failCall(
					state,
					child,
					callId,
					`exceeded hard timeout ${config.hardTimeoutMs}ms`,
				),
			)
			try {
				child.send({
					type: "invoke",
					callId,
					hook,
				} satisfies InvokeRequest)
			} catch (err) {
				state.pending.delete(callId)
				syncRef(state)
				timers.clearCallTimers(call)
				reject(err instanceof Error ? err : new Error(String(err)))
			}
		})
	}

	function failCall(
		state: PluginState,
		child: ChildProcess,
		callId: number,
		reason: string,
	): () => void {
		return () =>
			failChild(
				state,
				child,
				new Error(`plugin ${state.id} ${reason} (call ${callId})`),
			)
	}

	// -- message handling --

	function handleMessage(
		state: PluginState,
		child: ChildProcess,
		msg: WorkerMessage,
	): void {
		// Stale child from a replaced spawn: its messages must never
		// resolve the current child's load waiter or pending calls.
		if (state.child !== child) return
		if (msg === null || typeof msg !== "object") return
		switch (msg.type) {
			case "loaded": {
				const waiter = state.loadWaiter
				state.loadWaiter = undefined
				if (msg.ok) {
					state.hooks = msg.hooks ?? ["detect"]
					waiter?.resolve()
				} else {
					waiter?.reject(
						deserializeError(
							msg.error ?? { name: "Error", message: "plugin load failed" },
						),
					)
				}
				return
			}
			case "result": {
				const call = state.pending.get(msg.callId)
				if (call === undefined) return
				state.pending.delete(msg.callId)
				syncRef(state)
				timers.clearCallTimers(call)
				if (msg.ok) {
					call.resolve(msg.value)
				} else {
					call.reject(
						deserializeError(
							msg.error ?? { name: "Error", message: "hook failed" },
						),
					)
				}
				return
			}
			case "api": {
				const call = state.pending.get(msg.callId)
				if (call === undefined) return
				// Pause the watchdog while the host executes the API call —
				// a slow readFile/probeVideo is host work, not a hung plugin.
				call.apiInFlight += 1
				timers.pauseWatchdog(call)
				void dispatchApi(
					child,
					state,
					msg.callId,
					msg.apiCallId,
					call,
					msg.method,
					msg.args,
				)
				return
			}
			case "log": {
				const call = state.pending.get(msg.callId)
				if (call === undefined) return
				if (call.apiInFlight === 0) {
					timers.armWatchdog(
						call,
						failCall(
							state,
							child,
							msg.callId,
							`hung: no activity for ${config.watchdogMs}ms`,
						),
					)
				}
				dispatchLog(state.id, msg.method, msg.args)
				return
			}
		}
	}

	async function dispatchApi(
		child: ChildProcess,
		state: PluginState,
		callId: number,
		apiCallId: number,
		call: PendingCall,
		method: ApiMethodName,
		args: readonly unknown[],
	): Promise<void> {
		const respond = (
			ok: boolean,
			value?: unknown,
			error?: SerializedError,
		): void => {
			// The child may have died while the API call was in flight.
			if (state.child !== child) return
			try {
				child.send({ type: "apiResult", apiCallId, ok, value, error })
			} catch {
				// Channel closed — nothing to deliver.
			}
		}
		try {
			if (!isApiMethod(method) || LOG_METHOD_NAMES.has(method)) {
				respond(false, undefined, {
					name: "Error",
					message: `unknown API method: ${String(method)}`,
				})
				return
			}
			// Manifest permission gate, read from the single capability
			// table: every sandbox-gated method maps to its capability
			// and is denied unless the manifest declared it. The asset
			// surface then routes to the wired handler with the owning
			// plugin id — the ResourceAPI instance itself has no plugin
			// identity (a shared API serves every plugin's hooks).
			const capability = CAPABILITY_BY_METHOD.get(method)
			if (
				capability !== undefined &&
				state.permissions?.[capability] !== true
			) {
				respond(false, undefined, {
					name: "POLICY",
					code: "POLICY",
					message: `${capability} permission denied for plugin ${state.id} — declare "${capability}": true in the manifest to use ${method}()`,
				})
				return
			}
			if (ASSET_METHODS.has(method)) {
				const handler = config.pluginAssets
				if (handler === undefined) {
					respond(false, undefined, {
						name: "UNAVAILABLE",
						code: "UNAVAILABLE",
						message: `${method}() is unavailable on this host — plugin asset downloads need the app server runtime`,
					})
					return
				}
				// RPC boundary: the child-side proxy forwards args verbatim,
				// so the contract order is guaranteed (request object for
				// `download`, string path for the rest).
				if (method === "download") {
					respond(
						true,
						await handler.download(state.id, args[0] as PluginDownloadRequest),
					)
				} else if (method === "statAsset") {
					respond(true, await handler.statAsset(state.id, args[0] as string))
				} else if (method === "readAsset") {
					respond(true, await handler.readAsset(state.id, args[0] as string))
				} else {
					respond(true, await handler.deleteAsset(state.id, args[0] as string))
				}
				return
			}
			// RPC boundary: the child-side proxy is generated from the same
			// method list, so args always arrive in contract order.
			const fn = call.api[method] as (...a: readonly unknown[]) => unknown
			respond(true, await fn(...args))
		} catch (err) {
			respond(false, undefined, serializeError(err))
		} finally {
			call.apiInFlight -= 1
			// Resume the watchdog once the host-side work for this call
			// has drained and the call is still alive.
			if (call.apiInFlight === 0 && state.pending.get(callId) === call) {
				timers.armWatchdog(
					call,
					failCall(
						state,
						child,
						callId,
						`hung: no activity for ${config.watchdogMs}ms`,
					),
				)
			}
		}
	}

	/**
	 * Plugin log sink. The child-side proxy forwards log calls here, where
	 * the owning plugin id is known — ResourceAPI.log* stay no-ops because a
	 * shared API instance (e.g. one detect pass fanning out to every plugin)
	 * cannot attribute a log line to the plugin that emitted it.
	 */
	function dispatchLog(
		pluginId: string,
		method: "logInfo" | "logWarn" | "logError",
		args: readonly unknown[],
	): void {
		const message = typeof args[0] === "string" ? args[0] : String(args[0])
		const data = isPlainRecord(args[1]) ? args[1] : undefined
		const line = `[plugin:${pluginId}] ${message}`
		const extra = data === undefined ? [] : [data]
		try {
			if (method === "logInfo") console.log(line, ...extra)
			else if (method === "logWarn") console.warn(line, ...extra)
			else console.error(line, ...extra)
		} catch {
			// Logging must never break the host.
		}
	}

	return { loadPlugin, unloadPlugin, disposeExcept, disposeAll }
}

function isApiMethod(name: unknown): name is ApiMethodName {
	return (
		typeof name === "string" &&
		(API_METHOD_NAMES as readonly string[]).includes(name)
	)
}

function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value))
}

/**
 * The canonical on-disk form of a path, falling back to the resolved form
 * when the file does not exist yet (a just-built bundle, a not-yet-created
 * vault). Node's permission model checks the path the ESM loader resolved
 * through `realpathSync`, so a plugin dir reached via a symlink must be
 * granted and passed in its canonical form — otherwise the module resolves
 * outside its own grant and the sandbox refuses to load it.
 */
function realPathOrResolve(path: string): string {
	try {
		return realpathSync(path)
	} catch {
		return resolve(path)
	}
}

/**
 * vite-node's transform rewrites `import.meta` without a working `.resolve`
 * (unlike vitest's), so the worker entry URL falls back to the module's own
 * location. The packaged server bundle has a working `import.meta.resolve`
 * that still cannot see `@hoardodile/host` — that path also falls through
 * here. The sandbox runs from one of two places: the package dist root
 * (`dist/chunks/worker-entry.mjs`, see scripts/postbuild.mjs), or — in dev,
 * where the `development` export condition resolves `@hoardodile/host` to
 * source — `src/sandbox/worker-entry.mjs` next to this module.
 */
function resolveWorkerEntryUrl(): string {
	try {
		if (typeof import.meta.resolve === "function") {
			return import.meta.resolve("@hoardodile/host/worker-entry")
		}
	} catch {
		// No package exports (packaged server dist, or a broken install).
	}
	return workerEntryUrlFromModule(import.meta.url)
}

function workerEntryUrlFromModule(moduleUrl: string): string {
	const distIdx = moduleUrl.lastIndexOf("/dist/")
	if (distIdx >= 0) {
		const distRoot = moduleUrl.slice(0, distIdx + "/dist/".length)
		return new URL("chunks/worker-entry.mjs", distRoot).href
	}
	return new URL("worker-entry.mjs", moduleUrl).href
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
