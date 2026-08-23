import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pinnedSectionListCodec } from "@/features/overview/pinned/pinnedSectionListCodec"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import type { RouterContext } from "@/routes/__root"
import { stubCharCard, stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { OverviewPinnedRow } from "../components/OverviewPinnedRow"
import type { PinnedSectionItem } from "./types"
import { DEFAULT_PINNED_SIZE } from "./types"
import { buildOverviewPinnedResourceQueryOptions } from "./useOverviewPinnedData"

function createMockTrpcClient(
	handlers: Record<string, (input: unknown) => unknown>,
): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async (input: unknown) => {
									const key = `${namespace}.${procedure}`
									const handler = handlers[key]
									if (handler) return handler(input)
									if (namespace === "plugin" && procedure === "listAll")
										return []
									if (namespace === "tag" && procedure === "categories")
										return []
									if (namespace === "tag" && procedure === "listAll") return []
									return undefined
								},
								mutate: async (input: unknown) => {
									const key = `${namespace}.${procedure}`
									const handler = handlers[key]
									if (handler) return handler(input)
									return undefined
								},
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

const characterHandler = vi.fn((_input?: unknown) => ({
	rows: [stubCharCard("char-1", "Character One")],
	total: 1,
	page: 1,
	size: 6,
}))

const resourceHandler = vi.fn((_input?: unknown) => ({
	rows: [stubResCard("res-1", "Resource One")],
	total: 1,
	page: 1,
	size: 6,
}))

beforeEach(() => {
	localStorage.clear()
	prefSync.set(prefKeys.overviewPinnedCharacters, "[]")
	prefSync.set(prefKeys.overviewPinnedResources, "[]")
	setTrpcClient(
		createMockTrpcClient({
			"character.listCards": characterHandler,
			"resource.listCards": resourceHandler,
		}),
	)
	characterHandler.mockReset()
	characterHandler.mockImplementation(() => ({
		rows: [stubCharCard("char-1", "Character One")],
		total: 1,
		page: 1,
		size: 6,
	}))
	resourceHandler.mockReset()
	resourceHandler.mockImplementation(() => ({
		rows: [stubResCard("res-1", "Resource One")],
		total: 1,
		page: 1,
		size: 6,
	}))
})

function createRouterWith(element: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

	const testContext: RouterContext = {
		queryClient,
		trpc: {} as RouterContext["trpc"],
	}

	const rootRoute = createRootRouteWithContext<RouterContext>()({
		component: () => <Outlet />,
	})

	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => element,
	})

	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		context: testContext,
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultPendingMs: 0,
	})

	return { router, queryClient }
}

let currentQueryClient: QueryClient | undefined

async function renderSection(element: React.ReactElement) {
	const { router, queryClient } = createRouterWith(element)
	currentQueryClient = queryClient

	await act(async () => {
		await router.load()
	})

	let utils!: ReturnType<typeof render>
	await act(async () => {
		utils = render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
	return utils
}

afterEach(() => {
	currentQueryClient?.cancelQueries()
	currentQueryClient?.clear()
	currentQueryClient = undefined
})

function setPinnedCharacters(items: readonly PinnedSectionItem[]) {
	prefSync.set(
		prefKeys.overviewPinnedCharacters,
		pinnedSectionListCodec.encode(items),
	)
}

function setPinnedResources(items: readonly PinnedSectionItem[]) {
	prefSync.set(
		prefKeys.overviewPinnedResources,
		pinnedSectionListCodec.encode(items),
	)
}

describe("PinnedCharactersSection via OverviewPinnedRow", () => {
	it("is hidden when no pinned items", async () => {
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => {
			expect(screen.queryByText("Pinned characters")).not.toBeInTheDocument()
		})
	})

	it("renders pinned characters with default settings", async () => {
		setPinnedCharacters([{ id: "char-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByText("Pinned characters")).toBeInTheDocument()
		})
		expect(screen.getByText("Character One")).toBeInTheDocument()
		expect(characterHandler).toHaveBeenCalledWith(
			expect.objectContaining({ page: 1, size: DEFAULT_PINNED_SIZE }),
		)
	})

	it("uses custom title and size for a single item", async () => {
		setPinnedCharacters([{ id: "char-pin-1", title: "My chars", size: 3 }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByText("My chars")).toBeInTheDocument()
		})
		expect(screen.queryByRole("tab")).not.toBeInTheDocument()
		expect(characterHandler).toHaveBeenCalledWith(
			expect.objectContaining({ size: 3 }),
		)
	})

	it("renders tabs when multiple items exist", async () => {
		setPinnedCharacters([
			{ id: "char-pin-1", title: "First" },
			{ id: "char-pin-2", title: "Second" },
		])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByText("Pinned characters")).toBeInTheDocument()
		})
		expect(screen.getByRole("tab", { name: "First" })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: "Second" })).toBeInTheDocument()
	})

	it("hides empty tabs when multiple items exist", async () => {
		characterHandler.mockImplementation((input: unknown) => {
			const { query } = (input as { query?: string }) ?? {}
			if (query === "empty") {
				return { rows: [], total: 0, page: 1, size: 6 }
			}
			return {
				rows: [stubCharCard("char-1", "Character One")],
				total: 1,
				page: 1,
				size: 6,
			}
		})
		setPinnedCharacters([
			{ id: "char-pin-1", title: "First", query: "empty" },
			{ id: "char-pin-2", title: "Second" },
		])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(characterHandler).toHaveBeenCalledTimes(2)
		})
		expect(screen.queryByRole("tab", { name: "First" })).not.toBeInTheDocument()
		expect(screen.queryByRole("tab")).not.toBeInTheDocument()
		expect(screen.getByText("Character One")).toBeInTheDocument()
	})

	it("view all link carries current filters for single item", async () => {
		setPinnedCharacters([
			{
				id: "char-pin-1",
				query: "foo",
				tagIds: ["tag-a"],
				tagMode: "or",
				sortBy: "created",
				order: "asc",
				random: true,
				searchIntro: true,
			},
		])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByText("Pinned characters")).toBeInTheDocument()
		})
		const link = screen.getByText("View all").closest("a")
		expect(link).toHaveAttribute("href", expect.stringContaining("query=foo"))
		expect(link).toHaveAttribute("href", expect.stringContaining("tagIds"))
		expect(link).toHaveAttribute("href", expect.stringContaining("tagMode=or"))
		expect(link).toHaveAttribute(
			"href",
			expect.stringContaining("sortBy=created"),
		)
		expect(link).toHaveAttribute("href", expect.stringContaining("order=asc"))
		expect(link).toHaveAttribute("href", expect.stringContaining("random=true"))
		expect(link).toHaveAttribute(
			"href",
			expect.stringContaining("searchIntro=true"),
		)
	})

	it("hides section when item is empty", async () => {
		characterHandler.mockReturnValue({
			rows: [],
			total: 0,
			page: 1,
			size: 6,
		})
		setPinnedCharacters([{ id: "char-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(characterHandler).toHaveBeenCalled()
		})
		expect(
			screen.queryByTestId("overview-pinned-characters"),
		).not.toBeInTheDocument()
	})

	it("shows empty text when item is empty but showWhenEmpty is set", async () => {
		characterHandler.mockReturnValue({
			rows: [],
			total: 0,
			page: 1,
			size: 6,
		})
		setPinnedCharacters([{ id: "char-pin-1", showWhenEmpty: true }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(characterHandler).toHaveBeenCalled()
		})
		expect(screen.getByText("No matching characters.")).toBeInTheDocument()
	})
})

describe("PinnedResourcesSection via OverviewPinnedRow", () => {
	it("is hidden when no pinned items", async () => {
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => {
			expect(screen.queryByText("Pinned resources")).not.toBeInTheDocument()
		})
	})

	it("renders pinned resources", async () => {
		setPinnedResources([{ id: "res-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByText("Pinned resources")).toBeInTheDocument()
		})
		expect(screen.getByText("Resource One")).toBeInTheDocument()
	})

	it("hides empty tabs when multiple items exist", async () => {
		resourceHandler.mockImplementation((input: unknown) => {
			const { query } = (input as { query?: string }) ?? {}
			if (query === "empty") {
				return { rows: [], total: 0, page: 1, size: 6 }
			}
			return {
				rows: [stubResCard("res-1", "Resource One")],
				total: 1,
				page: 1,
				size: 6,
			}
		})
		setPinnedResources([
			{ id: "res-pin-1", title: "First", query: "empty" },
			{ id: "res-pin-2", title: "Second" },
		])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(resourceHandler).toHaveBeenCalledTimes(2)
		})
		expect(screen.queryByRole("tab", { name: "First" })).not.toBeInTheDocument()
		expect(screen.queryByRole("tab")).not.toBeInTheDocument()
		expect(screen.getByText("Resource One")).toBeInTheDocument()
	})

	it("view all link carries current filters", async () => {
		setPinnedResources([
			{
				id: "res-pin-1",
				query: "bar",
				tagIds: ["tag-b"],
				tagMode: "not",
				noCharacters: true,
				sortBy: "created",
				order: "asc",
				random: true,
				searchIntro: true,
			},
		])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByText("Pinned resources")).toBeInTheDocument()
		})
		const link = screen.getByText("View all").closest("a")
		expect(link).toHaveAttribute("href", expect.stringContaining("query=bar"))
		expect(link).toHaveAttribute("href", expect.stringContaining("tagIds"))
		expect(link).toHaveAttribute("href", expect.stringContaining("tagMode=not"))
		expect(link).toHaveAttribute(
			"href",
			expect.stringContaining("noCharacters=true"),
		)
		expect(link).toHaveAttribute(
			"href",
			expect.stringContaining("sortBy=created"),
		)
		expect(link).toHaveAttribute("href", expect.stringContaining("order=asc"))
		expect(link).toHaveAttribute("href", expect.stringContaining("random=true"))
		expect(link).toHaveAttribute(
			"href",
			expect.stringContaining("searchIntro=true"),
		)
	})

	it("hides section when item is empty", async () => {
		resourceHandler.mockReturnValue({
			rows: [],
			total: 0,
			page: 1,
			size: 6,
		})
		setPinnedResources([{ id: "res-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(resourceHandler).toHaveBeenCalled()
		})
		expect(
			screen.queryByTestId("overview-pinned-resources"),
		).not.toBeInTheDocument()
	})

	it("shows empty text when item is empty but showWhenEmpty is set", async () => {
		resourceHandler.mockReturnValue({
			rows: [],
			total: 0,
			page: 1,
			size: 6,
		})
		setPinnedResources([{ id: "res-pin-1", showWhenEmpty: true }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(resourceHandler).toHaveBeenCalled()
		})
		expect(screen.getByText("No matching resources.")).toBeInTheDocument()
	})
})

describe("OverviewPinnedRow", () => {
	it("is hidden when nothing is pinned", async () => {
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => {
			expect(
				screen.queryByTestId("overview-pinned-row"),
			).not.toBeInTheDocument()
		})
	})

	it("shows only characters section when only characters are pinned", async () => {
		setPinnedCharacters([{ id: "char-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(screen.getByTestId("overview-pinned-row")).toBeInTheDocument()
		})
		expect(screen.getByTestId("overview-pinned-characters")).toBeInTheDocument()
		expect(
			screen.queryByTestId("overview-pinned-resources"),
		).not.toBeInTheDocument()
	})

	it("shows both sections when both are pinned", async () => {
		setPinnedCharacters([{ id: "char-pin-1" }])
		setPinnedResources([{ id: "res-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-pinned-characters"),
			).toBeInTheDocument()
		})
		expect(screen.getByTestId("overview-pinned-resources")).toBeInTheDocument()
	})

	it("hides row when pinned section is empty", async () => {
		characterHandler.mockReturnValue({
			rows: [],
			total: 0,
			page: 1,
			size: 6,
		})
		setPinnedCharacters([{ id: "char-pin-1" }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(characterHandler).toHaveBeenCalled()
		})
		expect(screen.queryByTestId("overview-pinned-row")).not.toBeInTheDocument()
	})
})

describe("pinned refresh", () => {
	// The seed lives in the request input, which the listCards key factory
	// embeds in the query key — so the item id (fallback seed) shows up in
	// the serialized key.
	function randomItemQueryKeys(
		itemId: string,
	): readonly (readonly unknown[])[] {
		const all = currentQueryClient?.getQueryCache().getAll() ?? []
		return all
			.map((query) => query.queryKey)
			.filter((key) => JSON.stringify(key).includes(itemId))
	}

	function readStoredSeeds(): Record<string, string> {
		const raw = localStorage.getItem(prefKeys.overviewPinnedSeeds)
		if (raw === null) return {}
		const parsed: unknown = JSON.parse(raw)
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return {}
		}
		return parsed as Record<string, string>
	}

	it("sends a stable seed for random items across remounts", async () => {
		// "Never" disables the on-mount seed rotation, pinning the seed.
		setPinnedResources([{ id: "res-pin-random", random: true, refreshSec: -2 }])
		const first = await renderSection(<OverviewPinnedRow />)
		await waitFor(() => expect(resourceHandler).toHaveBeenCalledTimes(1))

		// Without a persisted seed the item id is the stable fallback seed.
		expect(resourceHandler).toHaveBeenLastCalledWith(
			expect.objectContaining({ random: true, seed: "res-pin-random" }),
		)
		const firstKeys = randomItemQueryKeys("res-pin-random")
		expect(firstKeys).toHaveLength(1)

		first.unmount()
		currentQueryClient = undefined

		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => expect(resourceHandler).toHaveBeenCalledTimes(2))
		expect(randomItemQueryKeys("res-pin-random")).toEqual(firstKeys)
	})

	it("section header refresh reshuffles the seed and refetches with it", async () => {
		setPinnedResources([{ id: "res-pin-random", random: true }])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() =>
			expect(resourceHandler.mock.calls.length).toBeGreaterThan(0),
		)

		const callsBefore = resourceHandler.mock.calls.length
		fireEvent.click(screen.getByTestId("pinned-section-refresh"))
		await waitFor(() =>
			expect(resourceHandler.mock.calls.length).toBeGreaterThan(callsBefore),
		)

		const firstSeed = readStoredSeeds()["res-pin-random"]
		expect(typeof firstSeed).toBe("string")
		expect(firstSeed).not.toBe("res-pin-random")
		expect(resourceHandler).toHaveBeenLastCalledWith(
			expect.objectContaining({ seed: firstSeed }),
		)

		const callsBeforeSecond = resourceHandler.mock.calls.length
		fireEvent.click(screen.getByTestId("pinned-section-refresh"))
		await waitFor(() =>
			expect(resourceHandler.mock.calls.length).toBeGreaterThan(
				callsBeforeSecond,
			),
		)
		expect(readStoredSeeds()["res-pin-random"]).not.toBe(firstSeed)
	})

	it("section header refresh rotates only the active item's seed", async () => {
		setPinnedResources([
			{ id: "res-pin-a", title: "A", random: true },
			{ id: "res-pin-b", title: "B", random: true },
		])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => {
			expect(typeof readStoredSeeds()["res-pin-a"]).toBe("string")
			expect(typeof readStoredSeeds()["res-pin-b"]).toBe("string")
		})
		const seedA = readStoredSeeds()["res-pin-a"]
		const seedB = readStoredSeeds()["res-pin-b"]

		fireEvent.click(
			within(screen.getByTestId("overview-pinned-resources")).getByTestId(
				"pinned-section-refresh",
			),
		)

		await waitFor(() => {
			expect(readStoredSeeds()["res-pin-a"]).not.toBe(seedA)
		})
		expect(readStoredSeeds()["res-pin-b"]).toBe(seedB)
	})

	it("section header refresh on a non-random item refetches only that section", async () => {
		setPinnedResources([{ id: "res-pin-1" }])
		setPinnedCharacters([{ id: "char-pin-1" }])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => {
			expect(resourceHandler).toHaveBeenCalled()
			expect(characterHandler).toHaveBeenCalled()
		})

		const invalidate = vi.spyOn(currentQueryClient!, "invalidateQueries")
		const resCallsBefore = resourceHandler.mock.calls.length
		const charCallsBefore = characterHandler.mock.calls.length

		fireEvent.click(
			within(screen.getByTestId("overview-pinned-resources")).getByTestId(
				"pinned-section-refresh",
			),
		)

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: expect.any(Array),
			exact: true,
		})
		await waitFor(() =>
			expect(resourceHandler.mock.calls.length).toBeGreaterThan(resCallsBefore),
		)
		expect(characterHandler.mock.calls.length).toBe(charCallsBefore)
	})

	it("section header refresh shows a skeleton until the refetch completes", async () => {
		setPinnedResources([{ id: "res-pin-1" }])
		await renderSection(<OverviewPinnedRow />)
		// Initial load finished: real rows, no skeleton.
		await waitFor(() =>
			expect(
				screen.queryByTestId("pinned-section-content-skeleton"),
			).not.toBeInTheDocument(),
		)

		const nextResult = {
			rows: [stubResCard("res-1", "Resource One")],
			total: 1,
			page: 1,
			size: 6,
		}
		let resolveNext: ((value: typeof nextResult) => void) | undefined
		resourceHandler.mockImplementationOnce(
			() =>
				// The tRPC mock awaits the handler, so a deferred promise works at
				// runtime; vitest types the mock by the sync default impl.
				new Promise<typeof nextResult>((resolve) => {
					resolveNext = resolve
				}) as unknown as ReturnType<typeof resourceHandler>,
		)

		fireEvent.click(screen.getByTestId("pinned-section-refresh"))

		await waitFor(() =>
			expect(
				screen.getByTestId("pinned-section-content-skeleton"),
			).toBeInTheDocument(),
		)
		expect(screen.getByTestId("pinned-section-refresh")).toBeDisabled()

		await act(async () => {
			resolveNext?.(nextResult)
		})
		await waitFor(() =>
			expect(
				screen.queryByTestId("pinned-section-content-skeleton"),
			).not.toBeInTheDocument(),
		)
		expect(screen.getByTestId("pinned-section-refresh")).toBeEnabled()
	})

	it("section header refresh on a random item shows a skeleton until new content loads", async () => {
		setPinnedResources([{ id: "res-pin-random", random: true }])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() =>
			expect(screen.getByText("Resource One")).toBeInTheDocument(),
		)

		const nextResult = {
			rows: [stubResCard("res-2", "Resource Two")],
			total: 1,
			page: 1,
			size: 6,
		}
		let resolveNext: ((value: typeof nextResult) => void) | undefined
		resourceHandler.mockImplementationOnce(
			() =>
				// The tRPC mock awaits the handler, so a deferred promise works at
				// runtime; vitest types the mock by the sync default impl.
				new Promise<typeof nextResult>((resolve) => {
					resolveNext = resolve
				}) as unknown as ReturnType<typeof resourceHandler>,
		)

		fireEvent.click(screen.getByTestId("pinned-section-refresh"))

		await waitFor(() =>
			expect(
				screen.getByTestId("pinned-section-content-skeleton"),
			).toBeInTheDocument(),
		)
		expect(screen.getByTestId("overview-pinned-resources")).toBeInTheDocument()

		await act(async () => {
			resolveNext?.(nextResult)
		})
		await waitFor(() =>
			expect(
				screen.queryByTestId("pinned-section-content-skeleton"),
			).not.toBeInTheDocument(),
		)
	})

	it("auto-refreshes on the item's configured interval", async () => {
		// One second is below the UI options but keeps the test on real timers.
		setPinnedResources([{ id: "res-pin-random", random: true, refreshSec: 1 }])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() =>
			expect(resourceHandler.mock.calls.length).toBeGreaterThan(0),
		)

		const callsBefore = resourceHandler.mock.calls.length
		await waitFor(
			() =>
				expect(resourceHandler.mock.calls.length).toBeGreaterThan(callsBefore),
			{ timeout: 2500 },
		)
	})

	it("rotates the random seed on mount when refresh is always", async () => {
		// refreshSec defaults to 0 (always): entering the overview is the
		// seed-rotation trigger, so a fresh seed is persisted and used.
		setPinnedResources([{ id: "res-pin-random", random: true }])
		await renderSection(<OverviewPinnedRow />)

		await waitFor(() => {
			expect(typeof readStoredSeeds()["res-pin-random"]).toBe("string")
		})
		const seed = readStoredSeeds()["res-pin-random"]
		expect(seed).not.toBe("res-pin-random")
		await waitFor(() => {
			expect(resourceHandler).toHaveBeenLastCalledWith(
				expect.objectContaining({ random: true, seed }),
			)
		})
	})

	it("does not rotate the random seed on mount when refresh is never", async () => {
		setPinnedResources([{ id: "res-pin-random", random: true, refreshSec: -2 }])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => expect(resourceHandler).toHaveBeenCalled())

		expect(readStoredSeeds()["res-pin-random"]).toBeUndefined()
		expect(resourceHandler).toHaveBeenLastCalledWith(
			expect.objectContaining({ random: true, seed: "res-pin-random" }),
		)
	})

	it("has no global refresh button; refresh lives on the section header", async () => {
		setPinnedResources([{ id: "res-pin-1" }])
		await renderSection(<OverviewPinnedRow />)
		await waitFor(() => {
			expect(screen.getByTestId("overview-pinned-row")).toBeInTheDocument()
		})
		expect(
			screen.queryByTestId("overview-pinned-refresh"),
		).not.toBeInTheDocument()
		expect(screen.getByTestId("pinned-section-refresh")).toBeInTheDocument()
	})
})

describe("buildOverviewPinnedResourceQueryOptions freeze", () => {
	it("freezes random sections only when refresh is not always", () => {
		const frozen = buildOverviewPinnedResourceQueryOptions(
			{ id: "res-pin-random", random: true },
			"seed-1",
			true,
		)
		expect(frozen.staleTime).toBe(Number.POSITIVE_INFINITY)

		const always = buildOverviewPinnedResourceQueryOptions(
			{ id: "res-pin-random", random: true },
			"seed-1",
			false,
		)
		expect(always.staleTime).not.toBe(Number.POSITIVE_INFINITY)

		const nonRandom = buildOverviewPinnedResourceQueryOptions(
			{ id: "res-pin-1" },
			undefined,
			true,
		)
		expect(nonRandom.staleTime).not.toBe(Number.POSITIVE_INFINITY)
	})
})
