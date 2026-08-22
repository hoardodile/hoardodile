import { Worker } from "node:worker_threads"
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
	transferListOf,
	type WorkerMessage,
} from "./protocol.ts"
import { createSandboxedPlugin } from "./sandboxed-plugin.ts"

/**
 * Kill a plugin worker when an invocation neither returns nor shows
 * resource-API activity for this long. Hooks that keep calling the API
 * reset the watchdog continuously and never trip it; time spent inside a
 * host-side API call does not count as inactivity.
 */
export const PLUGIN_WATCHDOG_TIMEOUT_MS = 60_000

/** Absolute cap for a single plugin hook invocation, regardless of activity. */
export const PLUGIN_HOOK_HARD_TIMEOUT_MS = 30 * 60_000

/** V8 old-generation memory cap per plugin worker, in MiB. */
export const PLUGIN_WORKER_MAX_OLD_SPACE_MB = 512

/**
 * Max worker spawns per plugin within {@link PLUGIN_WORKER_RESPAWN_WINDOW_MS}
 * before the plugin is degraded. It recovers automatically once the crash
 * window slides clean, or immediately on disable/rescan.
 */
export const PLUGIN_WORKER_MAX_RESPAWNS = 3

/** Sliding window for {@link PLUGIN_WORKER_MAX_RESPAWNS}. */
export const PLUGIN_WORKER_RESPAWN_WINDOW_MS = 60_000

export type PluginSandboxConfig = {
	/**
	 * Kill the worker when an invocation neither returns nor shows API
	 * activity for this long. Long-running hooks that keep calling the
	 * resource API reset the watchdog continuously and never trip it;
	 * time spent inside a host-side API call does not count as inactivity.
	 */
	readonly watchdogMs: number
	/** Absolute per-invocation cap, regardless of activity. */
	readonly hardTimeoutMs: number
	/** V8 old-generation cap per worker; exceeding it aborts the worker. */
	readonly maxOldSpaceMb: number
	/**
	 * Max worker spawns per plugin within {@link respawnWindowMs} before the
	 * plugin is degraded (all invocations reject). The plugin recovers
	 * automatically once the crash window slides clean; `unloadPlugin`
	 * (disable or rescan) resets the budget immediately.
	 */
	readonly maxRespawns: number
	readonly respawnWindowMs: number
}

export const DEFAULT_SANDBOX_CONFIG: PluginSandboxConfig = {
	watchdogMs: PLUGIN_WATCHDOG_TIMEOUT_MS,
	hardTimeoutMs: PLUGIN_HOOK_HARD_TIMEOUT_MS,
	maxOldSpaceMb: PLUGIN_WORKER_MAX_OLD_SPACE_MB,
	maxRespawns: PLUGIN_WORKER_MAX_RESPAWNS,
	respawnWindowMs: PLUGIN_WORKER_RESPAWN_WINDOW_MS,
}

export type PluginSandbox = {
	/**
	 * Register and load a plugin bundle. With `eager` the worker stays
	 * alive; without it the hook list is probed and the worker immediately
	 * idles (it respawns lazily on first invocation — disabled plugins
	 * still serve their bound resources without holding a worker).
	 *
	 * Reloading an already-registered id keeps the previous worker alive
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
	}) => Promise<PluginDefinition | undefined>
	/**
	 * Terminate the plugin's worker (if any) and reset its respawn budget.
	 * The hook list stays known; the next invocation lazily respawns.
	 */
	readonly unloadPlugin: (id: string) => void
	/**
	 * Terminate and forget every plugin whose id is not in `keepIds`.
	 * Registered ids keep their workers — used by the loader after a
	 * successful reload to free plugins that left the registry.
	 */
	readonly disposeExcept: (keepIds: ReadonlySet<string>) => Promise<void>
	/** Terminate every worker and forget all plugins. Pending invocations reject. */
	readonly disposeAll: () => Promise<void>
}

type LoadWaiter = {
	readonly resolve: () => void
	readonly reject: (err: Error) => void
}

type PluginState = {
	readonly id: string
	readonly mainPath: string
	worker: Worker | undefined
	hooks: readonly HookName[] | undefined
	loading: Promise<void> | undefined
	loadWaiter: LoadWaiter | undefined
	readonly pending: Map<number, PendingCall>
	respawnTimes: number[]
	degraded: boolean
	disposed: boolean
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
	}): Promise<PluginDefinition | undefined> {
		const previous = states.get(opts.id)
		const state: PluginState = {
			id: opts.id,
			mainPath: opts.mainPath,
			worker: undefined,
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
				// The previous worker never stopped being healthy — restore
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
		// The new bundle loaded: retire the previous worker only now —
		// in-flight invocations against it settle normally, and a failed
		// reload above never killed it in the first place.
		if (previous !== undefined) {
			previous.disposed = true
			await teardownWorker(previous)
		}
		if (!opts.eager) {
			void teardownWorker(state)
		}
		return createSandboxedPlugin(state.hooks ?? ["detect"], (hook, api) =>
			invoke(state, hook, api),
		)
	}

	function unloadPlugin(id: string): void {
		const state = states.get(id)
		if (state === undefined) return
		teardownWorker(state)
		state.respawnTimes = []
		state.degraded = false
	}

	async function disposeAll(): Promise<void> {
		const tasks: Promise<void>[] = []
		for (const state of states.values()) {
			state.disposed = true
			tasks.push(teardownWorker(state))
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
			tasks.push(teardownWorker(state))
		}
		await Promise.all(tasks)
	}

	// -- worker lifecycle --

	function ensureLoaded(state: PluginState): Promise<void> {
		if (state.worker !== undefined) return Promise.resolve()
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
				`plugin ${state.id} unavailable: worker respawned ${config.maxRespawns} times within ${config.respawnWindowMs}ms`,
			)
		}
		state.respawnTimes.push(now)

		// Resolve the worker entry through the package's own exports map
		// (`@hoardodile/host/worker-entry`) when that package is installed.
		// The sandbox module also gets inlined into the server bundle, where
		// there is no `@hoardodile/host` on disk — then we fall back to
		// `dist/chunks/worker-entry.mjs` next to the emitting chunk.
		// Kept out of a `new URL()` literal so Vite does not detect a browser
		// worker here: it would bundle worker-entry.mjs with node: builtins
		// shimmed out and rewrite the URL to an unusable /assets/ path. The
		// entry ships untransformed and must run as plain ESM in a worker thread.
		const worker = new Worker(new URL(resolveWorkerEntryUrl()), {
			resourceLimits: { maxOldGenerationSizeMb: config.maxOldSpaceMb },
		})
		// The sandbox must never hold the process open on its own.
		worker.unref()
		state.worker = worker

		worker.on("message", (msg: WorkerMessage) =>
			handleMessage(state, worker, msg),
		)
		worker.on("messageerror", (err: unknown) =>
			failWorker(state, worker, asError(err)),
		)
		worker.on("error", (err: unknown) =>
			failWorker(state, worker, asError(err)),
		)
		worker.on("exit", (code) => {
			if (state.worker === worker) {
				failWorker(
					state,
					worker,
					new Error(`plugin ${state.id} worker exited (code ${code})`),
				)
			}
		})

		const loaded = new Promise<void>((resolve, reject) => {
			state.loadWaiter = { resolve, reject }
		})
		worker.postMessage({ type: "load", mainPath: state.mainPath })
		try {
			await loaded
		} catch (err) {
			// A plugin whose main.js throws at import reports `loaded: ok:false`
			// and keeps idling — terminate the worker so it never outlives
			// its owning state (failWorker already covered error/exit).
			await teardownWorker(state)
			throw err
		} finally {
			state.loadWaiter = undefined
		}
	}

	/**
	 * Terminate the worker without touching the respawn budget. Rejects
	 * the load waiter and every pending call with `err` (or the standard
	 * "worker stopped" error) and clears the worker slot; a no-op when
	 * there is no worker.
	 */
	function teardownWorker(state: PluginState, err?: Error): Promise<void> {
		const worker = state.worker
		state.worker = undefined
		state.loading = undefined
		const stopErr = err ?? new Error(`plugin ${state.id} worker stopped`)
		state.loadWaiter?.reject(stopErr)
		state.loadWaiter = undefined
		rejectAllPending(state, stopErr)
		if (worker === undefined) return Promise.resolve()
		return worker.terminate().then(
			() => {},
			() => {},
		)
	}

	function failWorker(state: PluginState, worker: Worker, err: Error): void {
		if (state.worker !== worker) return // stale event from a replaced worker
		void teardownWorker(state, err)
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
					`plugin ${state.id} unavailable: worker crashed repeatedly`,
				)
			}
		}
		await ensureLoaded(state)
		const worker = state.worker
		if (worker === undefined) {
			throw new Error(`plugin ${state.id} worker unavailable`)
		}

		const callId = nextCallId++
		return new Promise((resolve, reject) => {
			const call: PendingCall = { api, resolve, reject, apiInFlight: 0 }
			state.pending.set(callId, call)
			timers.armWatchdog(
				call,
				failCall(
					state,
					worker,
					callId,
					`hung: no activity for ${config.watchdogMs}ms`,
				),
			)
			timers.armHardTimer(
				call,
				failCall(
					state,
					worker,
					callId,
					`exceeded hard timeout ${config.hardTimeoutMs}ms`,
				),
			)
			try {
				worker.postMessage({
					type: "invoke",
					callId,
					hook,
				} satisfies InvokeRequest)
			} catch (err) {
				state.pending.delete(callId)
				timers.clearCallTimers(call)
				reject(err instanceof Error ? err : new Error(String(err)))
			}
		})
	}

	function failCall(
		state: PluginState,
		worker: Worker,
		callId: number,
		reason: string,
	): () => void {
		return () =>
			failWorker(
				state,
				worker,
				new Error(`plugin ${state.id} ${reason} (call ${callId})`),
			)
	}

	// -- message handling --

	function handleMessage(
		state: PluginState,
		worker: Worker,
		msg: WorkerMessage,
	): void {
		// Stale worker from a replaced spawn: its messages must never
		// resolve the current worker's load waiter or pending calls.
		if (state.worker !== worker) return
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
					worker,
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
							worker,
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
		worker: Worker,
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
			// The worker may have died while the API call was in flight.
			if (state.worker !== worker) return
			worker.postMessage(
				{ type: "apiResult", apiCallId, ok, value, error },
				ok ? transferListOf(value) : [],
			)
		}
		try {
			if (!isApiMethod(method) || LOG_METHOD_NAMES.has(method)) {
				respond(false, undefined, {
					name: "Error",
					message: `unknown API method: ${String(method)}`,
				})
				return
			}
			// RPC boundary: the worker-side proxy is generated from the same
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
						worker,
						callId,
						`hung: no activity for ${config.watchdogMs}ms`,
					),
				)
			}
		}
	}

	/**
	 * Plugin log sink. The worker-side proxy forwards log calls here, where
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
