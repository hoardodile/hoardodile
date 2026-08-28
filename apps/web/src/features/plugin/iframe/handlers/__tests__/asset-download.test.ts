/**
 * @vitest-environment node
 */

import { pluginMethods } from "@hoardodile/sdk-web"
import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HostHandlerContext } from "../registry"

let pendingTickets: {
	readonly ticketId: string
	readonly pluginId: string
	readonly pluginName: string
	readonly items: readonly { readonly url: string; readonly dest: string }[]
}[] = []
let settleMutate: ((value: unknown) => void) | undefined

vi.mock("@/trpc/factory", () => ({
	trpcQuery: vi.fn(async (namespace: string, procedure: string) => {
		if (namespace === "pluginAsset" && procedure === "listPending") {
			return pendingTickets
		}
		throw new Error(`unexpected query: ${namespace}.${procedure}`)
	}),
	trpcMutate: vi.fn(
		() =>
			new Promise((resolve) => {
				settleMutate = resolve
			}),
	),
}))

import {
	getDownloadConsentSnapshot,
	resetDownloadConsent,
} from "@/features/plugin/download/consent-store"
import { trpcMutate, trpcQuery } from "@/trpc/factory"
import { createHandlers } from "../asset"

const ctx = {
	source: {} as Window,
	resId: "r-1",
	pluginId: "p-1",
} satisfies HostHandlerContext

const TICKET = {
	ticketId: "t-1",
	pluginId: "p-1",
	pluginName: "Live2D Viewer",
	items: [
		{
			url: "https://example.com/runtime/live2d.min.js",
			dest: "runtime/live2d.min.js",
		},
	],
}

const handlers = createHandlers(new QueryClient())
const downloadHandler = handlers.find(
	(e) => e.method === pluginMethods.download,
)
if (downloadHandler === undefined) throw new Error("download handler missing")

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	resetDownloadConsent()
	pendingTickets = []
	settleMutate = undefined
})

afterEach(() => {
	vi.useRealTimers()
})

describe("plugin asset download consent watch", () => {
	it("enqueues the plugin's pending tickets while the request is parked", async () => {
		pendingTickets = [TICKET]

		const pending = downloadHandler.handler(ctx, [TICKET.items[0]!])
		// The first poll tick is immediate: even before any interval fires
		// the pending ticket surfaces in the consent store.
		await vi.advanceTimersByTimeAsync(0)
		expect(getDownloadConsentSnapshot().queue.map((e) => e.ticketId)).toEqual([
			"t-1",
		])

		settleMutate?.([])
		await pending
	})

	it("never enqueues another plugin's tickets", async () => {
		pendingTickets = [{ ...TICKET, ticketId: "t-other", pluginId: "p-2" }]

		const pending = downloadHandler.handler(ctx, [TICKET.items[0]!])
		await vi.advanceTimersByTimeAsync(0)
		expect(getDownloadConsentSnapshot().queue).toEqual([])

		settleMutate?.([])
		await pending
	})

	it("stops polling once the request settles", async () => {
		pendingTickets = []

		const pending = downloadHandler.handler(ctx, [TICKET.items[0]!])
		await vi.advanceTimersByTimeAsync(0)
		const callsAfterStart = vi.mocked(trpcQuery).mock.calls.length

		settleMutate?.([])
		await pending
		await vi.advanceTimersByTimeAsync(5_000)

		expect(vi.mocked(trpcQuery).mock.calls.length).toBe(callsAfterStart)
		expect(vi.mocked(trpcMutate)).toHaveBeenCalledWith(
			"pluginAsset",
			"request",
			{
				pluginId: "p-1",
				items: [TICKET.items[0]!],
			},
		)
	})

	it("keeps polling across a transient listPending failure", async () => {
		pendingTickets = [TICKET]
		vi.mocked(trpcQuery).mockRejectedValueOnce(new Error("network"))

		const pending = downloadHandler.handler(ctx, [TICKET.items[0]!])
		await vi.advanceTimersByTimeAsync(0)
		expect(getDownloadConsentSnapshot().queue).toEqual([])
		await vi.advanceTimersByTimeAsync(1_000)
		expect(getDownloadConsentSnapshot().queue.map((e) => e.ticketId)).toEqual([
			"t-1",
		])

		settleMutate?.([])
		await pending
	})
})
