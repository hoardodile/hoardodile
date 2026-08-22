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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { RouterContext } from "@/routes/__root"
import { stubCharCard, stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { RecentViewedCard } from "./RecentViewedCard"

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

function stubUsageTotal(
	entityType: "resource" | "character" | "document",
	entityId: string,
	lastViewedAt: number,
) {
	return {
		id: `${entityType}:${entityId}`,
		entityType,
		entityId,
		granularity: "all",
		period: null,
		totalMs: 1000,
		viewCount: 1,
		lastViewedAt,
		updatedAt: lastViewedAt,
	}
}

const defaultHandlers: Record<string, (input: unknown) => unknown> = {
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
	"usage.listTotals": vi.fn((input: unknown) => {
		const { entityType } = input as { entityType: string }
		if (entityType === "resource") {
			return [
				stubUsageTotal("resource", "res-1", 300),
				stubUsageTotal("resource", "res-2", 600),
			]
		}
		if (entityType === "character") {
			return [stubUsageTotal("character", "char-1", 500)]
		}
		if (entityType === "document") {
			return [stubUsageTotal("document", "doc-1", 400)]
		}
		return []
	}),
	"resource.detailCard": (input: unknown) => {
		const { id } = input as { id: string }
		return { id, name: id === "res-2" ? "Resource Two" : "Resource One" }
	},
	"character.detailCard": () => ({ id: "char-1", name: "Character One" }),
	"document.nodeView": () => ({
		node: { id: "doc-1", title: "Document One" },
	}),
}

let originalClient: TRPCClient

beforeAll(() => {
	originalClient = createMockTrpcClient(defaultHandlers)
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
	const { router, queryClient } = createRouterWith(<RecentViewedCard />)

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

describe("RecentViewedCard", () => {
	it("renders the card title", async () => {
		await renderCard()

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-recent-viewed-block"),
			).toBeInTheDocument()
		})

		expect(
			screen.getByRole("heading", { name: "Usage history" }),
		).toBeInTheDocument()
	})

	it("renders the recently viewed items as a list", async () => {
		await renderCard()

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-recent-viewed-item-0"),
			).toBeInTheDocument()
		})

		const first = screen.getByTestId("overview-recent-viewed-item-0")
		expect(first).toHaveTextContent("Resource Two")
		expect(first).not.toHaveTextContent("Resources")
		expect(first).toHaveAttribute("href", "/resources/res-2")

		const second = screen.getByTestId("overview-recent-viewed-item-1")
		expect(second).toHaveTextContent("Character One")
		expect(second).not.toHaveTextContent("Characters")
		expect(second).toHaveAttribute("href", "/characters/char-1")

		const third = screen.getByTestId("overview-recent-viewed-item-2")
		expect(third).toHaveTextContent("Document One")
		expect(third).not.toHaveTextContent("Documents")
		expect(third).toHaveAttribute("href", "/documents/doc-1")

		expect(
			screen.queryByTestId("overview-recent-viewed-item-3"),
		).not.toBeInTheDocument()
	})

	it("view all links to the usage history page", async () => {
		await renderCard()

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-recent-viewed-view-all"),
			).toBeInTheDocument()
		})

		expect(
			screen.getByTestId("overview-recent-viewed-view-all"),
		).toHaveAttribute("href", "/usage")
	})

	it("shows empty state prompts when there is no viewing history", async () => {
		setTrpcClient(
			createMockTrpcClient({
				...defaultHandlers,
				"usage.listTotals": () => [],
			}),
		)
		await renderCard()

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-recent-viewed-browse"),
			).toBeInTheDocument()
		})

		expect(
			screen.getByTestId("overview-recent-viewed-upload"),
		).toBeInTheDocument()
	})
})
