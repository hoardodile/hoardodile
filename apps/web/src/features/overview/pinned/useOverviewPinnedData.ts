import {
	type QueryClient,
	type QueryKey,
	type UseQueryOptions,
	type UseQueryResult,
	useQueries,
	useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	type CharCardListResult,
	charListCardsQueryOptions,
} from "@/features/char/api"
import {
	type ResCardListResult,
	resListCardsQueryOptions,
} from "@/features/res/api"
import { usePrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"
import { randomUUID } from "@/lib/randomUUID"
import { pinnedSectionListCodec } from "./pinnedSectionListCodec"
import type { PinnedSectionItem } from "./types"
import {
	buildCharacterListInput,
	buildResourceListInput,
	isVisibleItem,
	type PinnedCharacterItemData,
	type PinnedResourceItemData,
} from "./usePinnedSectionData"

/**
 * Auto-refresh interval options in seconds: 0 = always (random sections
 * stay live and follow the data), -2 = never (frozen until a manual
 * refresh), -1 = once a day at local midnight, anything positive = a
 * timer in seconds. Configured per pinned item (see
 * `PinnedSectionItem.refreshSec`).
 */
export const PINNED_REFRESH_INTERVALS = [
	0, -2, 60, 1800, 3600, 21600, 43200, -1,
] as const

/**
 * Effective refresh interval for an item: unset means "always" (0), which
 * keeps legacy data on the pre-per-item default.
 */
function refreshSecOf(item: PinnedSectionItem): number {
	return item.refreshSec ?? 0
}

/**
 * Shared empty default for the pinned list prefs. `usePrefSync` memoizes
 * the decoded value on the default's identity, so an inline `[]` would
 * produce a new items array on every render and re-arm the schedulers
 * below on each seed rotation.
 */
const NO_PINNED_ITEMS: readonly PinnedSectionItem[] = []

function usePinnedItems(key: string) {
	return usePrefSync<readonly PinnedSectionItem[]>(
		key,
		NO_PINNED_ITEMS,
		pinnedSectionListCodec,
	)
}

function usePinnedSeeds() {
	return usePrefSync<Record<string, string>>(prefKeys.overviewPinnedSeeds, {})
}

/**
 * Seed for a pinned item's random ordering. Falls back to the item id so a
 * random section keeps the same result across mounts even before any seed
 * has been persisted; only an explicit refresh reshuffles.
 */
function seedForItem(
	seeds: Record<string, string>,
	item: PinnedSectionItem,
): string | undefined {
	if (item.random !== true) return undefined
	return seeds[item.id] ?? item.id
}

export function buildOverviewPinnedResourceQueryOptions(
	item: PinnedSectionItem,
	seed?: string,
	freeze = false,
) {
	const input = buildResourceListInput(item)
	const base = resListCardsQueryOptions({
		...input,
		// The seed is part of the request input, so the standard listCards
		// query key already changes when the seed rotates — no key override.
		seed,
		trash: false,
	}) as UseQueryOptions<ResCardListResult, Error, ResCardListResult, QueryKey>
	// Random sections: the backend ordering is deterministic for a given
	// seed, so unless refresh is "always" the result is frozen once
	// loaded — it stays put until an explicit refresh rotates the seed
	// (and thus the query key). Refreshes prefetch the new draw before
	// committing the seed (see usePinnedItemRefresh), so the key change
	// always lands on a warm cache and the section never flashes.
	return {
		...base,
		staleTime:
			seed !== undefined && freeze ? Number.POSITIVE_INFINITY : base.staleTime,
	}
}

export function buildOverviewPinnedCharacterQueryOptions(
	item: PinnedSectionItem,
	seed?: string,
	freeze = false,
) {
	const input = buildCharacterListInput(item)
	const base = charListCardsQueryOptions({
		...input,
		seed,
		trash: false,
	}) as UseQueryOptions<CharCardListResult, Error, CharCardListResult, QueryKey>
	// See buildOverviewPinnedResourceQueryOptions for why random sections
	// are frozen with staleTime: Infinity unless refresh is "always".
	return {
		...base,
		staleTime:
			seed !== undefined && freeze ? Number.POSITIVE_INFINITY : base.staleTime,
	}
}

/**
 * Fetch the next random draw for an item under a fresh seed without
 * committing it. The caller commits the seed on success, so the section's
 * query key only changes once the new rows are already cached — a seed
 * rotation never sends the section through a cache-miss pending state.
 */
function prefetchSeedRotation(
	qc: QueryClient,
	item: PinnedSectionItem,
	entityType: "resource" | "character",
	seed: string,
) {
	return entityType === "resource"
		? qc.fetchQuery(
				resListCardsQueryOptions({
					...buildResourceListInput(item),
					seed,
					trash: false,
				}),
			)
		: qc.fetchQuery(
				charListCardsQueryOptions({
					...buildCharacterListInput(item),
					seed,
					trash: false,
				}),
			)
}

export function useOverviewPinnedResources() {
	const [items] = usePinnedItems(prefKeys.overviewPinnedResources)
	const [seeds] = usePinnedSeeds()

	const queries = useQueries({
		queries: items.map((item) =>
			buildOverviewPinnedResourceQueryOptions(
				item,
				seedForItem(seeds, item),
				refreshSecOf(item) !== 0,
			),
		),
	})

	const itemsWithQueries = useMemo<PinnedResourceItemData[]>(
		() =>
			items.map((item, index) => ({
				item,
				query: queries[index] as UseQueryResult<ResCardListResult, Error>,
			})),
		[items, queries],
	)

	const visibleItems = useMemo(
		() =>
			itemsWithQueries.filter(({ item, query }) => isVisibleItem(item, query)),
		[itemsWithQueries],
	)
	const isPending = itemsWithQueries.some(({ query }) => query.isPending)

	return { visibleItems, isPending }
}

export function useOverviewPinnedCharacters() {
	const [items] = usePinnedItems(prefKeys.overviewPinnedCharacters)
	const [seeds] = usePinnedSeeds()

	const queries = useQueries({
		queries: items.map((item) =>
			buildOverviewPinnedCharacterQueryOptions(
				item,
				seedForItem(seeds, item),
				refreshSecOf(item) !== 0,
			),
		),
	})

	const itemsWithQueries = useMemo<PinnedCharacterItemData[]>(
		() =>
			items.map((item, index) => ({
				item,
				query: queries[index] as UseQueryResult<CharCardListResult, Error>,
			})),
		[items, queries],
	)

	const visibleItems = useMemo(
		() =>
			itemsWithQueries.filter(({ item, query }) => isVisibleItem(item, query)),
		[itemsWithQueries],
	)
	const isPending = itemsWithQueries.some(({ query }) => query.isPending)

	return { visibleItems, isPending }
}

/**
 * Manual refresh for a single pinned section item, used by the per-section
 * refresh button and the scheduled rotations. Random items prefetch their
 * next draw under a fresh seed and only then commit the seed (the seed is
 * part of the request input and thus the query key, so committing swaps
 * the section straight onto the cached new rows instead of a cache-miss
 * pending state); non-random items invalidate their exact listCards query
 * key without touching any other section. The returned promise resolves
 * once the refresh has landed and rejects if the fetch failed (the old
 * draw is kept then).
 */
export function usePinnedItemRefresh() {
	const qc = useQueryClient()
	const [seeds, setSeeds] = usePinnedSeeds()

	const seedsRef = useRef(seeds)
	seedsRef.current = seeds

	return useCallback(
		function refreshPinnedItem(
			item: PinnedSectionItem,
			entityType: "resource" | "character",
		) {
			if (item.random === true) {
				const seed = randomUUID()
				return prefetchSeedRotation(qc, item, entityType, seed).then(() => {
					// Update the ref synchronously so back-to-back rotations merge
					// from the latest snapshot rather than a stale render closure.
					const next = { ...seedsRef.current, [item.id]: seed }
					seedsRef.current = next
					setSeeds(next)
				})
			}
			const seed = seedForItem(seedsRef.current, item)
			const { queryKey } =
				entityType === "resource"
					? resListCardsQueryOptions({
							...buildResourceListInput(item),
							seed,
							trash: false,
						})
					: charListCardsQueryOptions({
							...buildCharacterListInput(item),
							seed,
							trash: false,
						})
			return qc.invalidateQueries({ queryKey, exact: true })
		},
		[qc, setSeeds],
	)
}

/**
 * Refresh-button state for one pinned section card. `refresh` triggers the
 * item's refresh and marks it refreshing until the new data has landed, so
 * the section shows a skeleton in place of its rows while waiting.
 */
export function usePinnedSectionRefresh<T>(
	entries: readonly {
		readonly item: PinnedSectionItem
		readonly query: UseQueryResult<T, Error>
	}[],
) {
	const refreshPinnedItem = usePinnedItemRefresh()
	const [refreshingId, setRefreshingId] = useState<string | null>(null)
	const sawFetchingRef = useRef(false)
	const startedAtRef = useRef(0)

	const refreshingQuery = entries.find(
		({ item }) => item.id === refreshingId,
	)?.query
	// Read during render (not only inside the effect) so React Query tracks
	// these props and re-renders the section when the fetch state flips.
	const isFetching = refreshingQuery?.isFetching === true
	const dataUpdatedAt = refreshingQuery?.dataUpdatedAt ?? 0

	useEffect(() => {
		if (refreshingId === null) return
		if (refreshingQuery === undefined) {
			sawFetchingRef.current = false
			setRefreshingId(null)
			return
		}
		if (isFetching) {
			sawFetchingRef.current = true
			return
		}
		// `dataUpdatedAt` covers refreshes that never surface as fetching on
		// the watched query (a seed rotation commits onto a prefetched
		// cache, or a fetch starts and finishes between two renders).
		if (sawFetchingRef.current || dataUpdatedAt > startedAtRef.current) {
			sawFetchingRef.current = false
			setRefreshingId(null)
		}
	}, [refreshingId, refreshingQuery, isFetching, dataUpdatedAt])

	function refresh(
		item: PinnedSectionItem,
		entityType: "resource" | "character",
	) {
		sawFetchingRef.current = false
		startedAtRef.current = Date.now()
		setRefreshingId(item.id)
		refreshPinnedItem(item, entityType).catch(() => {
			// Failed refreshes keep the old draw; drop the skeleton again.
			sawFetchingRef.current = false
			setRefreshingId(null)
		})
	}

	return { refreshingId, refresh }
}

/**
 * Scheduled auto-refresh for the overview pinned sections, dispatched per
 * item: each random item's own `refreshSec` decides how (and whether) it
 * draws a new set — 0 on overview mount, a positive interval via
 * setInterval (one timer per distinct value), -1 on a re-armed midnight
 * timeout chain, -2 never. Changing the item list or a strategy re-arms
 * the schedulers. Rotations go through `usePinnedItemRefresh`, which
 * prefetches the new draw before committing the seed, so a scheduled
 * rotation swaps content in place instead of collapsing the section.
 */
export function useOverviewPinnedRefresh() {
	const refreshPinnedItem = usePinnedItemRefresh()
	const [resItems] = usePinnedItems(prefKeys.overviewPinnedResources)
	const [charItems] = usePinnedItems(prefKeys.overviewPinnedCharacters)

	const randomEntries = useMemo(
		() =>
			[
				...resItems.map((item) => ({ item, entityType: "resource" as const })),
				...charItems.map((item) => ({
					item,
					entityType: "character" as const,
				})),
			].filter(({ item }) => item.random === true),
		[resItems, charItems],
	)

	const randomEntriesRef = useRef(randomEntries)
	randomEntriesRef.current = randomEntries

	function rotateSeedsFor(entries: typeof randomEntries) {
		for (const { item, entityType } of entries) {
			// A failed rotation keeps the old draw; the next fire retries.
			refreshPinnedItem(item, entityType).catch(() => {})
		}
	}

	// "Always" (0) has no scheduler, so mounting the overview (entering the
	// route or reloading the page) is the only rotation trigger. Rotate the
	// mount-policy items once per mount; the ref guards against StrictMode's
	// double effect invocation reshuffling twice.
	const mountRefreshRef = useRef(false)
	useEffect(() => {
		if (mountRefreshRef.current) return
		const entries = randomEntriesRef.current.filter(
			({ item }) => refreshSecOf(item) === 0,
		)
		if (entries.length === 0) return
		mountRefreshRef.current = true
		rotateSeedsFor(entries)
	}, [randomEntries])

	// Interval and midnight schedulers. Grouping by interval value keeps one
	// timer per distinct value; the midnight group re-arms a timeout after
	// each fire instead of a 24h interval, so the schedule stays pinned to
	// 00:00. -2 items get no scheduler at all.
	useEffect(() => {
		const byInterval = new Map<number, typeof randomEntries>()
		const midnightEntries: typeof randomEntries = []
		for (const entry of randomEntries) {
			const sec = refreshSecOf(entry.item)
			if (sec > 0) {
				const group = byInterval.get(sec)
				if (group) {
					group.push(entry)
				} else {
					byInterval.set(sec, [entry])
				}
			} else if (sec === -1) {
				midnightEntries.push(entry)
			}
		}

		const timers: ReturnType<typeof setInterval>[] = []
		for (const [sec, entries] of byInterval) {
			timers.push(
				setInterval(() => {
					rotateSeedsFor(entries)
				}, sec * 1000),
			)
		}

		let midnightTimer: ReturnType<typeof setTimeout> | undefined
		if (midnightEntries.length > 0) {
			function arm() {
				const now = new Date()
				const nextMidnight = new Date(
					now.getFullYear(),
					now.getMonth(),
					now.getDate() + 1,
				)
				midnightTimer = setTimeout(() => {
					rotateSeedsFor(midnightEntries)
					arm()
				}, nextMidnight.getTime() - now.getTime())
			}
			arm()
		}

		return () => {
			for (const timer of timers) {
				clearInterval(timer)
			}
			if (midnightTimer !== undefined) {
				clearTimeout(midnightTimer)
			}
		}
	}, [randomEntries])
}
