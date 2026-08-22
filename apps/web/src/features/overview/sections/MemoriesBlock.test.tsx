import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RouterContext } from "@/routes/__root"
import { stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { MemoriesBlock } from "./MemoriesBlock"

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

const memoriesHandler = vi.fn((_input?: unknown): unknown[] => [])

beforeEach(() => {
	setTrpcClient(createMockTrpcClient({ "resource.memories": memoriesHandler }))
	memoriesHandler.mockReset()
	memoriesHandler.mockImplementation(() => [])
})

async function renderBlock() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const rootRoute = createRootRouteWithContext<RouterContext>()({
		component: () => <Outlet />,
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <MemoriesBlock />,
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

describe("MemoriesBlock", () => {
	it("renders nothing when there are no memories today", async () => {
		await renderBlock()
		expect(
			screen.queryByTestId("overview-memories-block"),
		).not.toBeInTheDocument()
	})

	it("sends the current calendar day and UTC offset to the server", async () => {
		await renderBlock()
		expect(memoriesHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				month: expect.any(Number),
				day: expect.any(Number),
				offsetMin: expect.any(Number),
			}),
		)
	})

	it("captions each card with how many years ago it was hoarded", async () => {
		const now = Date.now()
		const year = new Date(now).getFullYear()
		const lastYear = new Date(year - 1, 0, 1).getTime()
		const threeYearsAgo = new Date(year - 3, 0, 1).getTime()
		memoriesHandler.mockImplementation(() => [
			stubResCard("res-1", "Last year", { createdAt: lastYear }),
			stubResCard("res-2", "Three years", { createdAt: threeYearsAgo }),
		])
		await renderBlock()

		expect(
			await screen.findByTestId("overview-memories-block"),
		).toBeInTheDocument()
		expect(screen.getByText("Last year on this day")).toBeInTheDocument()
		expect(screen.getByText("3 years ago on this day")).toBeInTheDocument()
		expect(screen.getByText("Last year")).toBeInTheDocument()
		expect(screen.getByText("Three years")).toBeInTheDocument()
	})
})
