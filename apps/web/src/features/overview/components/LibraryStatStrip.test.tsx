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
import { beforeAll, describe, expect, it } from "vitest"
import type { RouterContext } from "@/routes/__root"
import { stubCharCard, stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { LibraryStatStrip } from "./LibraryStatStrip"

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

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"resource.listCards": () => ({
				rows: [stubResCard("res-1", "Resource One")],
				total: 7,
				page: 1,
				size: 6,
			}),
			"character.listCards": () => ({
				rows: [stubCharCard("char-1", "Character One")],
				total: 3,
				page: 1,
				size: 6,
			}),
			"document.tree": () => [
				{
					id: "doc-1",
					kind: "document",
					title: "Document One",
					position: 0,
					createdAt: 100,
					updatedAt: 100,
				},
			],
			"comment.list": () => ({
				rows: [],
				total: 0,
				totalAll: 12,
			}),
		}),
	)
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

async function renderStrip() {
	const { router, queryClient } = createRouterWith(<LibraryStatStrip />)

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

describe("LibraryStatStrip", () => {
	it("renders compact counts for all four categories", async () => {
		await renderStrip()

		await waitFor(() => {
			expect(screen.getByTestId("overview-stat-resources")).toHaveTextContent(
				"7",
			)
		})

		expect(screen.getByTestId("overview-stat-characters")).toHaveTextContent(
			"3",
		)
		expect(screen.getByTestId("overview-stat-documents")).toHaveTextContent("1")
		expect(screen.getByTestId("overview-stat-comments")).toHaveTextContent("12")
	})
})
