import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { RouterContext } from "@/routes/__root"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { OverviewFootprintsCard } from "./OverviewFootprintsCard"

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

const emptyHandlers: Record<string, (input: unknown) => unknown> = {
	"trace.timeline": () => ({ rows: [], total: 0 }),
}

let originalClient: TRPCClient

beforeAll(() => {
	originalClient = createMockTrpcClient(emptyHandlers)
	setTrpcClient(originalClient)
})

beforeEach(() => {
	setTrpcClient(originalClient)
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

async function renderCard() {
	const { router, queryClient } = createRouterWith(<OverviewFootprintsCard />)

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

describe("OverviewFootprintsCard", () => {
	it("shows empty state prompts when there are no footprints", async () => {
		await renderCard()

		await waitFor(() => {
			expect(screen.getByTestId("overview-footprints-card")).toBeInTheDocument()
		})

		expect(
			screen.getByRole("heading", { name: "Footprints" }),
		).toBeInTheDocument()
		const upload = screen.getByTestId("overview-footprints-upload")
		expect(upload).toHaveAttribute("href", "/resources/new")
		const importLink = screen.getByTestId("overview-footprints-import")
		expect(importLink).toHaveAttribute("href", "/resources/import")
	})
})
