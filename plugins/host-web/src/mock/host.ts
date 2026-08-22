import type { DanmakuListFilter } from "@hoardodile/sdk-types"
import {
	type HostPush,
	type HostResponse,
	hostPushKeys,
	invalidatePushKeys,
	type PluginIframeContext,
	pluginMethods,
} from "@hoardodile/sdk-web"
import { requestSchemas } from "../host-core/request-schemas.ts"
import type { HostBinding } from "../host-core/router.ts"
import {
	createHostRouter,
	defineHandler,
	type HostHandlerEntry,
} from "../host-core/router.ts"
import type { MockFileBackend } from "./file-backends.ts"
import {
	createMockDanmakuStore,
	createMockMessageStore,
	type MockDanmakuStore,
	type MockMessageStore,
} from "./stores.ts"

/**
 * The offline host side of the plugin postMessage bridge. Implements the
 * same routing, validation and scoping as the production host (via
 * host-core) with in-memory data — so plugin iframes run with no server
 * at all. Shared by automated component tests (jsdom: register the test
 * window) and the manual workbench page (register the real iframe
 * window).
 */

export type MockHostLogger = {
	readonly info: (message: string, data?: unknown) => void
	readonly warn: (message: string, data?: unknown) => void
	readonly error: (message: string, data?: unknown) => void
}

const defaultLogger: MockHostLogger = {
	info(message, data) {
		console.log(`[mock-host] ${message}`, data ?? "")
	},
	warn(message, data) {
		console.warn(`[mock-host] ${message}`, data ?? "")
	},
	error(message, data) {
		console.error(`[mock-host] ${message}`, data ?? "")
	},
}

export type MockHostOptions = {
	/**
	 * Window that receives plugin postMessage traffic: the page window in
	 * a workbench, the test window in jsdom. The host listens on it and
	 * posts responses to it.
	 */
	readonly targetWindow: Window
	readonly files: MockFileBackend
	readonly messages?: MockMessageStore
	readonly danmaku?: MockDanmakuStore
	/** Initial plugin-scoped prefs. */
	readonly prefs?: Readonly<Record<string, string>>
	/** Initial plugin+resId cache entries. */
	readonly cache?: Readonly<Record<string, string>>
	readonly logger?: MockHostLogger
	/** Called after a plugin writes a pref. */
	readonly onPrefChanged?: (key: string, value: string) => void
	/** Called after a plugin writes a cache entry. */
	readonly onCacheChanged?: (resId: string, key: string, value: string) => void
}

export type MockHost = {
	/**
	 * Bind a message source to a plugin/resource. The real host binds
	 * iframe contentWindows; jsdom tests register the test window itself
	 * (plugin code posts to `window.parent`, which is itself).
	 */
	readonly register: (source: unknown, binding: HostBinding) => void
	readonly unregister: (source: unknown) => void
	/** Push a host event to one source. */
	readonly push: (source: unknown, key: string, data?: unknown) => void
	/** Push the plugin context (the iframe mounts on this). */
	readonly pushContext: (source: unknown, ctx: PluginIframeContext) => void
	readonly setVisibility: (source: unknown, visible: boolean) => void
	readonly messages: MockMessageStore
	readonly danmaku: MockDanmakuStore
	readonly prefs: ReadonlyMap<string, string>
	readonly cache: ReadonlyMap<string, string>
	readonly dispose: () => void
}

export function createMockHost(opts: MockHostOptions): MockHost {
	const targetWindow = opts.targetWindow
	const logger = opts.logger ?? defaultLogger
	const messages = opts.messages ?? createMockMessageStore()
	const danmaku = opts.danmaku ?? createMockDanmakuStore()
	const prefs = new Map(Object.entries(opts.prefs ?? {}))
	const cache = new Map(Object.entries(opts.cache ?? {}))
	const bindings = new Map<unknown, HostBinding>()
	const subscriptions = new Map<unknown, Set<string>>()

	function postToSource(source: unknown, msg: HostPush | HostResponse): void {
		;(source as Window).postMessage(msg, "*")
	}

	function pushToSource(source: unknown, key: string, data?: unknown): void {
		postToSource(source, { type: "push", key, data })
	}

	const handlers: readonly HostHandlerEntry[] = [
		defineHandler(
			pluginMethods.readFile,
			requestSchemas[pluginMethods.readFile],
			async (ctx, params) => {
				return opts.files.readFile(ctx.resId, params.path, params.range)
			},
		),

		defineHandler(pluginMethods.listFiles, async (ctx) => {
			// Production answers with the rows the plugin's own listFiles
			// hook produced; a backend that can obtain them serves those.
			const entries = await opts.files.listFileEntries?.(ctx.resId)
			if (entries !== undefined) return entries
			// No hook (or no way to reach it): the server falls back to
			// bare, naturally sorted filenames — mirror that exactly, or
			// plugins typed against the fallback shape break here only.
			const names = [...(await opts.files.listFiles(ctx.resId))]
			names.sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
			)
			return names
		}),

		defineHandler(
			pluginMethods.logInfo,
			requestSchemas[pluginMethods.logInfo],
			(_ctx, params) => {
				logger.info(logMessage(params), logData(params))
			},
		),
		defineHandler(
			pluginMethods.logWarn,
			requestSchemas[pluginMethods.logWarn],
			(_ctx, params) => {
				logger.warn(logMessage(params), logData(params))
			},
		),
		defineHandler(
			pluginMethods.logError,
			requestSchemas[pluginMethods.logError],
			(_ctx, params) => {
				logger.error(logMessage(params), logData(params))
			},
		),

		defineHandler(pluginMethods.listMessages, async (ctx) => {
			return messages.list(ctx.resId)
		}),

		defineHandler(
			pluginMethods.createMessage,
			requestSchemas[pluginMethods.createMessage],
			async (ctx, params) => {
				const anchor =
					params.anchor === undefined
						? undefined
						: { ...params.anchor, resId: ctx.resId }
				return messages.create(ctx.resId, { body: params.body, anchor })
			},
		),

		defineHandler(
			pluginMethods.listDanmaku,
			requestSchemas[pluginMethods.listDanmaku],
			async (ctx, params) => {
				const rows = danmaku.list(ctx.resId)
				const filter = params.filter
				if (filter === undefined) return rows
				return rows.filter((d) => matchesDanmakuFilter(d.anchor.data, filter))
			},
		),

		defineHandler(
			pluginMethods.createDanmaku,
			requestSchemas[pluginMethods.createDanmaku],
			async (ctx, params) => {
				return danmaku.create(ctx.resId, {
					text: params.text,
					anchor: { ...params.anchor, resId: ctx.resId },
					mode: params.mode,
				})
			},
		),

		defineHandler(
			pluginMethods.setPref,
			requestSchemas[pluginMethods.setPref],
			async (_ctx, params) => {
				prefs.set(params.key, params.value)
				opts.onPrefChanged?.(params.key, params.value)
			},
		),

		defineHandler(
			pluginMethods.setCache,
			requestSchemas[pluginMethods.setCache],
			async (ctx, params) => {
				// A write from a never-bound iframe has nowhere to land —
				// drop it silently, same as the production host.
				if (ctx.resId === "") return
				cache.set(`${ctx.resId}:${params.key}`, params.value)
				opts.onCacheChanged?.(ctx.resId, params.key, params.value)
			},
		),

		defineHandler(
			pluginMethods.invalidate,
			requestSchemas[pluginMethods.invalidate],
			async (ctx, params) => {
				// Notify the caller so its query hooks refetch — the mock's
				// stores are the source of truth, so the refetch returns the
				// updated data.
				pushToSource(ctx.source, invalidatePushKeys[params.target])
			},
		),
	]

	const router = createHostRouter(handlers, {
		resolveSource(event) {
			// jsdom delivers same-window messages with source nulled out;
			// real iframes always carry their contentWindow.
			const source = event.source === null ? targetWindow : event.source
			const record = bindings.get(source)
			if (record === undefined) return undefined
			return { source, record }
		},
		respond(source, response) {
			postToSource(source, response)
		},
		subscribe(source, key) {
			let keys = subscriptions.get(source)
			if (keys === undefined) {
				keys = new Set()
				subscriptions.set(source, keys)
			}
			keys.add(key)
		},
	})

	function onMessage(event: MessageEvent): void {
		router(event)
	}
	targetWindow.addEventListener("message", onMessage)

	return {
		register(source, binding) {
			bindings.set(source, binding)
		},
		unregister(source) {
			bindings.delete(source)
			subscriptions.delete(source)
		},
		push(source, key, data) {
			pushToSource(source, key, data)
		},
		pushContext(source, ctx) {
			pushToSource(source, hostPushKeys.context, ctx)
		},
		setVisibility(source, visible) {
			pushToSource(source, hostPushKeys.visibility, { visible })
		},
		messages,
		danmaku,
		prefs,
		cache,
		dispose() {
			targetWindow.removeEventListener("message", onMessage)
			bindings.clear()
			subscriptions.clear()
		},
	}
}

function logMessage(params: unknown): string {
	const p = params as { message?: unknown } | undefined
	return typeof p?.message === "string" ? p.message : String(params)
}

function logData(params: unknown): unknown {
	const p = params as { data?: unknown } | undefined
	return p?.data
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Matches a danmaku against the plugin-declared filter: every declared
 * field must equal the value stored under the same key in the anchor's
 * `data` — identical semantics to the production host handler.
 */
function matchesDanmakuFilter(
	data: unknown,
	filter: DanmakuListFilter,
): boolean {
	if (!isRecord(data)) return false
	for (const [key, value] of Object.entries(filter)) {
		if (value !== undefined && data[key] !== value) return false
	}
	return true
}
