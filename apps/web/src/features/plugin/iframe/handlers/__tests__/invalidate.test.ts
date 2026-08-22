/**
 * @vitest-environment node
 */

import { invalidatePushKeys, pluginMethods } from "@hoardodile/sdk-web"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HostHandlerContext, HostHandlerEntry } from "../registry"

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(async () => ({ rows: [] })),
	trpcMutate: vi.fn(async () => ({})),
}))

vi.mock("@/features/plugin/iframe/iframe-registry", () => ({
	broadcastToAll: vi.fn(),
	broadcastToResource: vi.fn(),
	broadcastToSubscribers: vi.fn(),
}))

import {
	broadcastToResource,
	broadcastToSubscribers,
} from "@/features/plugin/iframe/iframe-registry"
import { createHandlers as createInvalidateHandlers } from "../invalidate"

const ctx = {
	source: {} as Window,
	resId: "r-1",
	pluginId: "p-1",
} satisfies HostHandlerContext

const invalidateHandlers = createInvalidateHandlers(new QueryClient())

function invalidateHandler() {
	const entry = invalidateHandlers.find(
		(e: HostHandlerEntry) => e.method === pluginMethods.invalidate,
	)
	if (entry === undefined) throw new Error("invalidate handler not found")
	return entry.handler
}

beforeEach(() => {
	vi.clearAllMocks()
})

// After the TanStack-side invalidation, the handler completes the
// `*:invalidate` push link: plugin-side query hooks subscribe to these
// keys and refetch. Resource-scoped targets go only to the iframes bound
// to the handler's resource; the global `resources` target goes to every
// subscribed iframe.
describe("invalidate push broadcasting", () => {
	it("resource broadcasts res:invalidate to the iframe's resource", async () => {
		await invalidateHandler()(ctx, { target: "resource" })
		expect(broadcastToResource).toHaveBeenCalledWith(ctx.resId, {
			type: "push",
			key: invalidatePushKeys.resource,
		})
		expect(broadcastToSubscribers).not.toHaveBeenCalled()
	})

	it("resources broadcasts resources:invalidate to subscribers only", async () => {
		await invalidateHandler()(ctx, { target: "resources" })
		expect(broadcastToSubscribers).toHaveBeenCalledWith(
			invalidatePushKeys.resources,
		)
		expect(broadcastToResource).not.toHaveBeenCalled()
	})

	it("messages broadcasts messages:invalidate to the iframe's resource", async () => {
		await invalidateHandler()(ctx, { target: "messages" })
		expect(broadcastToResource).toHaveBeenCalledWith(ctx.resId, {
			type: "push",
			key: invalidatePushKeys.messages,
		})
		expect(broadcastToSubscribers).not.toHaveBeenCalled()
	})

	it("danmaku broadcasts danmaku:invalidate to the iframe's resource", async () => {
		await invalidateHandler()(ctx, { target: "danmaku" })
		expect(broadcastToResource).toHaveBeenCalledWith(ctx.resId, {
			type: "push",
			key: invalidatePushKeys.danmaku,
		})
		expect(broadcastToSubscribers).not.toHaveBeenCalled()
	})
})
