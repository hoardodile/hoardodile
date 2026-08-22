/**
 * @vitest-environment node
 */

import { pluginMethods } from "@hoardodile/sdk-web"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HostHandlerContext, HostHandlerEntry } from "../registry"

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(async (namespace: string) => {
		if (namespace === "danmaku") {
			return [
				{
					id: "d1",
					anchor: {
						resId: "r-1",
						data: { kind: "videoTime", filename: "a.mp4", timeMs: 100 },
					},
				},
				{
					id: "d2",
					anchor: {
						resId: "r-1",
						data: { kind: "videoTime", filename: "b.mp4", timeMs: 50 },
					},
				},
				{ id: "d3", anchor: { resId: "r-1" } },
			]
		}
		return { rows: [] }
	}),
	trpcMutate: vi.fn(async () => ({})),
}))

vi.mock("@/features/plugin/iframe/iframe-registry", () => ({
	broadcastToAll: vi.fn(),
}))

import { trpcMutate, trpcQuery } from "@/trpc/factory"
import { createHandlers as createCommentHandlers } from "../comment"
import { createHandlers as createDanmakuHandlers } from "../danmaku"
import { createHandlers as createPreferenceHandlers } from "../preference"

const ctx = {
	source: {} as Window,
	resId: "r-1",
	pluginId: "p-1",
} satisfies HostHandlerContext

function handlerOf(entries: readonly HostHandlerEntry[], method: string) {
	const entry = entries.find((e) => e.method === method)
	if (entry === undefined) throw new Error(`handler not found: ${method}`)
	return entry.handler
}

const commentHandlers = createCommentHandlers(new QueryClient())
const danmakuHandlers = createDanmakuHandlers(new QueryClient())
const preferenceHandlers = createPreferenceHandlers(new QueryClient())

beforeEach(() => {
	vi.clearAllMocks()
})

// Bridge handlers never trust a resId taken from message params: the
// iframe's registered resource (ctx.resId) is authoritative. A plugin
// that sends a foreign resId is not rejected — the value is simply
// ignored/overridden.
describe("bridge resource scoping", () => {
	it("listMessages serves the iframe's own resource", async () => {
		const handler = handlerOf(commentHandlers, pluginMethods.listMessages)
		await handler(ctx, { resId: "r-1" })
		expect(trpcQuery).toHaveBeenCalledWith("comment", "list", {
			resId: "r-1",
		})
	})

	it("listMessages ignores a foreign resId", async () => {
		const handler = handlerOf(commentHandlers, pluginMethods.listMessages)
		await handler(ctx, { resId: "other" })
		expect(trpcQuery).toHaveBeenCalledWith("comment", "list", {
			resId: "r-1",
		})
	})

	it("createMessage forwards an anchor on the iframe's resource", async () => {
		const handler = handlerOf(commentHandlers, pluginMethods.createMessage)
		await handler(ctx, {
			body: "hello",
			anchor: { data: { paragraphIndex: 2 } },
		})
		expect(trpcMutate).toHaveBeenCalledWith("comment", "create", {
			body: "hello",
			anchor: { data: { paragraphIndex: 2 } },
			anchorResId: "r-1",
		})
	})

	it("createMessage strips a plugin-supplied anchor resId", async () => {
		const handler = handlerOf(commentHandlers, pluginMethods.createMessage)
		await handler(ctx, {
			body: "hi",
			anchor: { resId: "other", data: { paragraphIndex: 1 } },
		})
		expect(trpcMutate).toHaveBeenCalledWith("comment", "create", {
			body: "hi",
			anchor: { data: { paragraphIndex: 1 } },
			anchorResId: "r-1",
		})
	})

	it("createMessage without an anchor creates an unanchored message", async () => {
		const handler = handlerOf(commentHandlers, pluginMethods.createMessage)
		await handler(ctx, { body: "hello" })
		expect(trpcMutate).toHaveBeenCalledWith("comment", "create", {
			body: "hello",
			anchor: undefined,
			anchorResId: "r-1",
		})
	})

	it("listDanmaku ignores a foreign resId", async () => {
		const handler = handlerOf(danmakuHandlers, pluginMethods.listDanmaku)
		await handler(ctx, { resId: "other" })
		expect(trpcQuery).toHaveBeenCalledWith("danmaku", "list", {
			anchor: { resId: "r-1" },
		})
	})

	it("listDanmaku without a filter returns the full resource list", async () => {
		const handler = handlerOf(danmakuHandlers, pluginMethods.listDanmaku)
		const rows = (await handler(ctx, {})) as readonly { id: string }[]
		expect(rows.map((d) => d.id)).toEqual(["d1", "d2", "d3"])
	})

	it("listDanmaku applies the filter against anchor data", async () => {
		const handler = handlerOf(danmakuHandlers, pluginMethods.listDanmaku)
		const rows = (await handler(ctx, {
			filter: { kind: "videoTime", filename: "a.mp4" },
		})) as readonly { id: string }[]
		expect(rows.map((d) => d.id)).toEqual(["d1"])
	})

	it("createDanmaku strips a plugin-supplied anchor resId", async () => {
		const handler = handlerOf(danmakuHandlers, pluginMethods.createDanmaku)
		await handler(ctx, {
			text: "hi",
			anchor: { resId: "other", data: { timeMs: 1 } },
		})
		expect(trpcMutate).toHaveBeenCalledWith("danmaku", "create", {
			text: "hi",
			anchor: { data: { timeMs: 1 } },
			anchorResId: "r-1",
			mode: undefined,
		})
	})

	it("setCache scopes to the iframe's resource", async () => {
		const handler = handlerOf(preferenceHandlers, pluginMethods.setCache)
		await handler(ctx, { key: "position", value: "12" })
		expect(trpcMutate).toHaveBeenCalledWith("pluginPreference", "cacheSet", {
			pluginId: "p-1",
			resId: "r-1",
			key: "position",
			value: "12",
		})
	})

	it("setCache from a released iframe is dropped silently", async () => {
		const handler = handlerOf(preferenceHandlers, pluginMethods.setCache)
		const unbound = { ...ctx, resId: "" } satisfies HostHandlerContext
		await handler(unbound, { key: "position", value: "12" })
		expect(trpcMutate).not.toHaveBeenCalled()
	})
})
