import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { pinnedSectionListCodec } from "./pinnedSectionListCodec"
import type { PinnedSectionItem } from "./types"
import { useOverviewPinnedRefresh } from "./useOverviewPinnedData"

/**
 * Rotations prefetch the next draw through the real tRPC client before
 * committing the seed, so the tests need a mock backend. Empty rows are
 * fine — only the fetch succeeding matters.
 */
function createMockTrpcClient(): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async (_input: unknown) => {
									if (procedure === "listCards") {
										return { rows: [], total: 0, page: 1, size: 10 }
									}
									if (namespace === "plugin" && procedure === "listAll")
										return []
									return undefined
								},
								mutate: async (_input: unknown) => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

function wrapper(qc: QueryClient) {
	return function QueryWrapper(props: { readonly children: ReactNode }) {
		return (
			<QueryClientProvider client={qc}>{props.children}</QueryClientProvider>
		)
	}
}

function setPinnedResources(items: readonly PinnedSectionItem[]) {
	prefSync.set(
		prefKeys.overviewPinnedResources,
		pinnedSectionListCodec.encode(items),
	)
}

function readStoredSeeds(): Record<string, string> {
	const raw = localStorage.getItem(prefKeys.overviewPinnedSeeds)
	if (raw === null) return {}
	const parsed: unknown = JSON.parse(raw)
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {}
	}
	return parsed as Record<string, string>
}

beforeEach(() => {
	localStorage.clear()
	prefSync.set(prefKeys.overviewPinnedResources, "[]")
	prefSync.set(prefKeys.overviewPinnedCharacters, "[]")
	setTrpcClient(createMockTrpcClient())
})

/**
 * Items with refreshSec = -1 schedule one seed rotation at each local
 * midnight via a re-armed timeout (not a 24h interval, which would drift
 * off 00:00).
 */
describe("useOverviewPinnedRefresh midnight schedule", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("rotates the item seed at the next local midnight and re-arms", async () => {
		vi.setSystemTime(new Date(2026, 0, 15, 13, 30))
		setPinnedResources([
			{ id: "res-pin-midnight", random: true, refreshSec: -1 },
			{ id: "res-pin-never", random: true, refreshSec: -2 },
		])
		const qc = new QueryClient()
		renderHook(() => useOverviewPinnedRefresh(), { wrapper: wrapper(qc) })

		const msToMidnight = new Date(2026, 0, 16).getTime() - Date.now()
		await vi.advanceTimersByTimeAsync(msToMidnight - 1000)
		expect(readStoredSeeds()).toEqual({})

		// The seed commits once the prefetched draw has landed.
		await vi.advanceTimersByTimeAsync(1000)
		await vi.waitFor(() => {
			expect(typeof readStoredSeeds()["res-pin-midnight"]).toBe("string")
		})
		const firstSeed = readStoredSeeds()["res-pin-midnight"]
		// -2 items are never scheduled, even when another item fires.
		expect(readStoredSeeds()["res-pin-never"]).toBeUndefined()

		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
		await vi.waitFor(() => {
			expect(readStoredSeeds()["res-pin-midnight"]).not.toBe(firstSeed)
		})
	})
})

/**
 * Items with refreshSec = 0 ("always", the default when unset) have no
 * scheduler, so mounting the overview is the trigger that rotates their
 * seeds once per visit.
 */
describe("useOverviewPinnedRefresh mount refresh (always)", () => {
	it("rotates seeds on mount for random items without an interval", async () => {
		setPinnedResources([
			{ id: "res-pin-random", random: true },
			{ id: "res-pin-always", random: true, refreshSec: 0 },
		])
		const qc = new QueryClient()
		renderHook(() => useOverviewPinnedRefresh(), { wrapper: wrapper(qc) })

		// The seed commits once the prefetched draw has landed.
		await waitFor(() => {
			const seeds = readStoredSeeds()
			expect(typeof seeds["res-pin-random"]).toBe("string")
			expect(typeof seeds["res-pin-always"]).toBe("string")
		})
		const seeds = readStoredSeeds()
		expect(seeds["res-pin-random"]).not.toBe("res-pin-random")
		expect(seeds["res-pin-always"]).not.toBe("res-pin-always")
	})

	it("does not rotate seeds on mount when no item is random", () => {
		setPinnedResources([{ id: "res-pin-1" }])
		const qc = new QueryClient()
		renderHook(() => useOverviewPinnedRefresh(), { wrapper: wrapper(qc) })

		expect(readStoredSeeds()).toEqual({})
	})

	it("does not rotate seeds on mount for items with their own policy", () => {
		setPinnedResources([
			{ id: "res-pin-never", random: true, refreshSec: -2 },
			{ id: "res-pin-hourly", random: true, refreshSec: 3600 },
			{ id: "res-pin-midnight", random: true, refreshSec: -1 },
		])
		const qc = new QueryClient()
		renderHook(() => useOverviewPinnedRefresh(), { wrapper: wrapper(qc) })

		expect(readStoredSeeds()).toEqual({})
	})
})

/**
 * Positive refreshSec values get one setInterval per distinct value,
 * rotating only the items in that group.
 */
describe("useOverviewPinnedRefresh interval schedule", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("rotates each interval group independently", async () => {
		setPinnedResources([
			{ id: "res-pin-minute", random: true, refreshSec: 60 },
			{ id: "res-pin-hourly", random: true, refreshSec: 3600 },
			{ id: "res-pin-never", random: true, refreshSec: -2 },
			{ id: "res-pin-1" },
		])
		const qc = new QueryClient()
		renderHook(() => useOverviewPinnedRefresh(), { wrapper: wrapper(qc) })

		await vi.advanceTimersByTimeAsync(60 * 1000)
		await vi.waitFor(() => {
			expect(typeof readStoredSeeds()["res-pin-minute"]).toBe("string")
		})
		expect(readStoredSeeds()["res-pin-hourly"]).toBeUndefined()
		expect(readStoredSeeds()["res-pin-never"]).toBeUndefined()

		await vi.advanceTimersByTimeAsync(3600 * 1000)
		await vi.waitFor(() => {
			expect(typeof readStoredSeeds()["res-pin-hourly"]).toBe("string")
		})
		expect(readStoredSeeds()["res-pin-never"]).toBeUndefined()
	})
})
