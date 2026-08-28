import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import type { ResCardListResult } from "@/features/res/api"
import type { RouterContext } from "@/routes/__root"
import { stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { ResSearch } from "./ResSearch"

let resolveListCards: ((value: ResCardListResult) => void) | undefined
const listResolvers: ((value: ResCardListResult) => void)[] = []
let sentinelCallback: IntersectionObserverCallback | undefined

// The repo test setup stubs IntersectionObserver as a no-op; this one captures
// the masonry sentinel's callback so we can trigger load-more programmatically.
class CapturingIntersectionObserver {
	constructor(callback: IntersectionObserverCallback) {
		sentinelCallback = callback
	}
	observe() {}
	unobserve() {}
	disconnect() {}
	root = null
	rootMargin = ""
	thresholds: number[] = []
	takeRecords() {
		return []
	}
}

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
								query: async (_payload: unknown) => {
									if (
										namespace === "resource" &&
										(procedure === "listCards" ||
											procedure === "trashListCards")
									) {
										return new Promise<ResCardListResult>((resolve) => {
											listResolvers.push(resolve)
											resolveListCards = resolve
										})
									}
									if (namespace === "plugin" && procedure === "listAll")
										return []
									if (namespace === "resource" && procedure === "sourceNames")
										return []
									if (namespace === "resCollection" && procedure === "listAll")
										return []
									return undefined
								},
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

const PAGE_SIZE = 10
const TOTAL = 50

function listPage(page: number): ResCardListResult {
	const start = (page - 1) * PAGE_SIZE
	const count = Math.max(0, Math.min(PAGE_SIZE, TOTAL - start))
	return {
		rows: Array.from({ length: count }, (_, i) =>
			stubResCard(`res-${start + i + 1}`, `Resource ${start + i + 1}`),
		),
		total: TOTAL,
		page,
		size: PAGE_SIZE,
	}
}

async function renderSearch() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	const rootRoute = createRootRouteWithContext<RouterContext>()({
		component: () => <Outlet />,
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<ResSearch initialState={{ view: "masonry", size: PAGE_SIZE }} />
		),
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		context: { queryClient, trpc: {} as RouterContext["trpc"] },
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultPendingMs: 0,
	})

	await act(async () => {
		await router.load()
	})
	await act(async () => {
		render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
}

beforeEach(() => {
	resolveListCards = undefined
	listResolvers.length = 0
	sentinelCallback = undefined
	Object.defineProperty(window, "IntersectionObserver", {
		writable: true,
		configurable: true,
		value: CapturingIntersectionObserver,
	})
	setTrpcClient(createMockTrpcClient())
})

describe("ResSearch masonry infinite list", () => {
	it("renders the waterfall skeleton while the first page is loading", async () => {
		await renderSearch()
		expect(screen.getByTestId("resource-masonry-skeleton")).toBeInTheDocument()
	})

	it("renders a single (top) pagination bar and the masonry list once loaded", async () => {
		await renderSearch()
		await act(async () => {
			resolveListCards?.(listPage(1))
		})

		await waitFor(() => {
			expect(
				screen.queryByTestId("resource-masonry-skeleton"),
			).not.toBeInTheDocument()
		})

		// The masonry has no duplicate bottom pagination bar — just the top one.
		expect(screen.getAllByTestId("pagination-bar")).toHaveLength(1)
		expect(screen.getByTestId("resource-list")).toBeInTheDocument()
		// The top pager anchors at the current page and carries the count label.
		const bar = screen.getByTestId("pagination-bar")
		expect(within(bar).getAllByTestId("pagination-current")).toHaveLength(1)
	})

	it("appends the next page instead of replacing the previously loaded cards", async () => {
		await renderSearch()
		// Page one.
		await act(async () => {
			listResolvers[0]?.(listPage(1))
		})
		await waitFor(() => {
			expect(
				screen.queryByTestId("resource-masonry-skeleton"),
			).not.toBeInTheDocument()
		})
		// First page cards visible.
		expect(screen.getByTestId("resource-item-res-1")).toBeInTheDocument()

		// The sentinel observer is armed once the first page renders; firing it
		// triggers load-more (prefetch).
		await waitFor(() => expect(sentinelCallback).toBeDefined())
		await act(async () => {
			sentinelCallback?.(
				[{ isIntersecting: true } as IntersectionObserverEntry],
				{} as IntersectionObserver,
			)
		})
		// Page two begins loading.
		await waitFor(() => expect(listResolvers.length).toBeGreaterThanOrEqual(2))
		await act(async () => {
			listResolvers[1]?.(listPage(2))
		})

		// Accumulated: both pages rendered, page-one card still present.
		await waitFor(() => {
			expect(
				screen.getByTestId("resource-list").querySelectorAll("li"),
			).toHaveLength(PAGE_SIZE * 2)
		})
		expect(screen.getByTestId("resource-item-res-1")).toBeInTheDocument()
		expect(screen.getByTestId("resource-item-res-11")).toBeInTheDocument()
	})
})
