import {
	type HostResponse,
	type PluginMessage,
	PROTOCOL_VERSION,
} from "@hoardodile/sdk-web"
import type { z } from "zod"

/**
 * The shared host-side protocol core: message demux, method routing,
 * per-method param validation, stale-request scoping and the response
 * envelope. Both the real host (apps/web) and the offline mock host
 * assemble on this module, so routing and validation never drift.
 */

/** What a registered iframe (or mock window) is bound to. */
export type HostBinding = {
	readonly pluginId: string
	readonly resId: string
}

export type HostRouterDeps = {
	/**
	 * Authenticate an inbound message event: narrow it to a trusted source
	 * + binding, or return `undefined` to drop the message. The real host
	 * validates origin/source against its iframe registry; the mock
	 * validates against its own registered windows.
	 */
	readonly resolveSource: (
		event: MessageEvent,
	) => { readonly source: unknown; readonly record: HostBinding } | undefined
	/** Send a response back to the source (the layer's postMessage exit). */
	readonly respond: (source: unknown, response: HostResponse) => void
	/** Record a subscription key for the source. */
	readonly subscribe: (source: unknown, key: string) => void
}

export type HostHandlerContext = {
	readonly source: unknown
	/**
	 * The resource this request is scoped to: the source's current
	 * binding ("" only for never-bound sources). Requests stamped by the
	 * SDK with a different resource are dropped as stale before they
	 * reach a handler.
	 */
	readonly resId: string
	readonly pluginId: string
}

export type HostHandlerEntry = {
	readonly method: string
	/** Param schema; validated in the router before the handler runs. */
	readonly schema: z.ZodTypeAny | undefined
	readonly handler: (
		ctx: HostHandlerContext,
		params: unknown,
	) => Promise<unknown>
}

export function defineHandler<TReturn>(
	method: string,
	handler: (ctx: HostHandlerContext) => Promise<TReturn> | TReturn,
): HostHandlerEntry

export function defineHandler<TSchema extends z.ZodTypeAny, TReturn>(
	method: string,
	schema: TSchema,
	handler: (
		ctx: HostHandlerContext,
		params: z.infer<TSchema>,
	) => Promise<TReturn> | TReturn,
): HostHandlerEntry

export function defineHandler(
	method: string,
	schemaOrHandler:
		| z.ZodTypeAny
		| ((ctx: HostHandlerContext) => Promise<unknown> | unknown),
	maybeHandler?: (
		ctx: HostHandlerContext,
		params: unknown,
	) => Promise<unknown> | unknown,
): HostHandlerEntry {
	if (typeof schemaOrHandler === "function") {
		return {
			method,
			schema: undefined,
			handler: async (ctx) => schemaOrHandler(ctx),
		}
	}
	if (maybeHandler === undefined) {
		throw new Error(`defineHandler("${method}") called without a handler`)
	}
	return {
		method,
		schema: schemaOrHandler,
		handler: async (ctx, params) => maybeHandler(ctx, params),
	}
}

/**
 * Create the per-window message handler: authenticates the event,
 * routes requests by method, validates params, drops stale scopes and
 * wraps every outcome in the response envelope.
 */
export function createHostRouter(
	handlers: readonly HostHandlerEntry[],
	deps: HostRouterDeps,
): (event: MessageEvent) => void {
	const registry = new Map<string, HostHandlerEntry["handler"]>()
	const schemas = new Map<string, z.ZodTypeAny>()
	for (const entry of handlers) {
		if (registry.has(entry.method)) {
			throw new Error(`Duplicate handler method: ${entry.method}`)
		}
		registry.set(entry.method, entry.handler)
		if (entry.schema !== undefined) schemas.set(entry.method, entry.schema)
	}

	// Warn once per source so a mismatched plugin build does not spam the
	// console on every message, while still surfacing the problem loudly.
	const warnedSources = new WeakSet<object>()

	return function handleMessage(event: MessageEvent) {
		const resolved = deps.resolveSource(event)
		if (resolved === undefined) return
		const { source, record } = resolved

		const msg = event.data as PluginMessage
		if (msg == null || typeof msg !== "object" || msg.type === undefined) {
			return
		}

		// Protocol handshake: every SDK-build plugin stamps its messages
		// with the protocol version it was built against. A mismatch (or a
		// missing stamp — an old plugin build) means the wire contract may
		// have drifted; the message still routes so old plugins keep
		// working, but the developer gets a loud warning.
		const proto = (msg as { proto?: unknown }).proto
		if (proto !== PROTOCOL_VERSION && !warnedSources.has(source as object)) {
			warnedSources.add(source as object)
			if (proto === undefined) {
				console.warn(
					`[host-web] plugin iframe (${record.pluginId}) did not stamp its protocol version — it was built against an older SDK. Assuming PROTOCOL_VERSION ${PROTOCOL_VERSION}; rebuild the plugin to silence this warning.`,
				)
			} else {
				console.warn(
					`[host-web] plugin iframe (${record.pluginId}) speaks protocol version ${String(proto)} but this host speaks ${PROTOCOL_VERSION} — the plugin was built against a different SDK version and may misbehave.`,
				)
			}
		}

		if (msg.type === "subscribe") {
			deps.subscribe(source, msg.key)
			return
		}

		if (msg.type !== "request") return

		function respond(response: HostResponse): void {
			deps.respond(source, response)
		}

		// The SDK stamps each request with the resource it was issued for
		// (PluginRequest.resId). A stamp that no longer matches the
		// binding marks the request as stale — the tree that issued it is
		// gone (e.g. an unmount flush racing a rebind) — so it is dropped
		// silently instead of leaking into the wrong resource. Unstamped
		// requests (older plugin builds) use the current binding, which
		// outlives release, so late flushes after a close still land.
		if (
			typeof msg.resId === "string" &&
			msg.resId !== "" &&
			msg.resId !== record.resId
		) {
			respond({ type: "response", id: msg.id, ok: true })
			return
		}

		const ctx: HostHandlerContext = {
			source,
			resId: record.resId,
			pluginId: record.pluginId,
		}

		const handler = registry.get(msg.method)
		if (handler === undefined) {
			respond({
				type: "response",
				id: msg.id,
				ok: false,
				error: `Unknown method: ${msg.method}`,
			})
			return
		}

		let params: unknown
		const schema = schemas.get(msg.method)
		if (schema !== undefined) {
			const parsed = schema.safeParse(msg.params)
			if (!parsed.success) {
				respond({
					type: "response",
					id: msg.id,
					ok: false,
					error: `Invalid params for ${msg.method}: ${parsed.error.message}`,
				})
				return
			}
			params = parsed.data
		} else {
			params = msg.params
		}

		handler(ctx, params)
			.then((data) => {
				respond({ type: "response", id: msg.id, ok: true, data })
			})
			.catch((err) => {
				respond({
					type: "response",
					id: msg.id,
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				})
			})
	}
}
