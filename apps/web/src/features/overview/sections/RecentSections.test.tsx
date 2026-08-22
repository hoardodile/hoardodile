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
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { RouterContext } from "@/routes/__root"
import { stubCharCard, stubResCard } from "@/test/stubs/cards"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"

import { RecentCharactersSection } from "./RecentCharactersSection"
import { RecentCharactersStrip } from "./RecentCharactersStrip"
import { RecentCommentsSection } from "./RecentCommentsSection"
import { RecentDocumentsSection } from "./RecentDocumentsSection"
import { RecentResourcesSection } from "./RecentResourcesSection"
import { RecentResourcesStrip } from "./RecentResourcesStrip"

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

const resourceHandler = vi.fn((input: unknown) => {
	const { sortBy } = input as { sortBy: string }
	const updatedFirst = [
		stubResCard("res-updated", "Updated Resource", {
			createdAt: 50,
			updatedAt: 100,
		}),
		stubResCard("res-created", "Created Resource", {
			createdAt: 100,
			updatedAt: 50,
		}),
	]
	return {
		rows: sortBy === "created" ? [...updatedFirst].reverse() : updatedFirst,
		total: 2,
		page: 1,
		size: 6,
	}
})

const characterHandler = vi.fn((input: unknown) => {
	const { sortBy } = input as { sortBy: string }
	const updatedFirst = [
		stubCharCard("char-updated", "Updated Character", {
			createdAt: 50,
			updatedAt: 100,
		}),
		stubCharCard("char-created", "Created Character", {
			createdAt: 100,
			updatedAt: 50,
		}),
	]
	return {
		rows: sortBy === "created" ? [...updatedFirst].reverse() : updatedFirst,
		total: 2,
		page: 1,
		size: 6,
	}
})

const documentHandler = vi.fn(() => [
	{
		id: "doc-created",
		kind: "document",
		title: "Created Document",
		position: 0,
		createdAt: 100,
		updatedAt: 50,
	},
	{
		id: "doc-updated",
		kind: "document",
		title: "Updated Document",
		position: 0,
		createdAt: 50,
		updatedAt: 100,
	},
])

const commentHandler = vi.fn(() => ({
	rows: [
		{
			id: "comment-1",
			body: "A recent comment.",
			createdAt: Date.now(),
			charIds: [],
			resIds: [],
			likeCount: 0,
			dislikeCount: 0,
			replyCount: 0,
		},
	],
	total: 1,
	totalAll: 5,
}))

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"resource.listCards": resourceHandler,
			"character.listCards": characterHandler,
			"document.tree": documentHandler,
			"comment.list": commentHandler,
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

async function renderSection(element: React.ReactElement) {
	const { router, queryClient } = createRouterWith(element)

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

describe("RecentResourcesSection", () => {
	it("summary shows total count", async () => {
		await renderSection(<RecentResourcesSection />)
		await waitFor(() => {
			expect(screen.getByTestId("overview-stat-resources")).toHaveTextContent(
				"2",
			)
		})
	})
})

describe("RecentResourcesStrip", () => {
	it("renders recent resources as a card strip sorted by sortBy", async () => {
		resourceHandler.mockClear()
		await renderSection(<RecentResourcesStrip sortBy="created" />)

		await waitFor(() => {
			expect(
				screen.getByTestId("resource-item-res-updated"),
			).toBeInTheDocument()
		})
		expect(
			screen.getByTestId("overview-activity-resources"),
		).toBeInTheDocument()
		expect(resourceHandler).toHaveBeenCalledWith(
			expect.objectContaining({ sortBy: "created", size: 8 }),
		)
	})
})

describe("RecentCharactersSection", () => {
	it("summary shows total count", async () => {
		await renderSection(<RecentCharactersSection />)
		await waitFor(() => {
			expect(screen.getByTestId("overview-stat-characters")).toHaveTextContent(
				"2",
			)
		})
	})
})

describe("RecentCharactersStrip", () => {
	it("renders recent characters as a card strip sorted by sortBy", async () => {
		characterHandler.mockClear()
		await renderSection(<RecentCharactersStrip sortBy="created" />)

		await waitFor(() => {
			expect(
				screen.getByTestId("character-item-char-updated"),
			).toBeInTheDocument()
		})
		expect(
			screen.getByTestId("overview-activity-characters"),
		).toBeInTheDocument()
		expect(characterHandler).toHaveBeenCalledWith(
			expect.objectContaining({ sortBy: "created", size: 8 }),
		)
	})
})

describe("RecentDocumentsSection", () => {
	it("summary shows total count", async () => {
		await renderSection(<RecentDocumentsSection mode="summary" />)
		await waitFor(() => {
			expect(screen.getByTestId("overview-stat-documents")).toHaveTextContent(
				"2",
			)
		})
	})

	it("list sorts by updated when sortBy is updated", async () => {
		await renderSection(<RecentDocumentsSection mode="list" sortBy="updated" />)

		await waitFor(() => {
			const docs = screen.getAllByTestId(/^overview-doc-/)
			expect(docs[0]).toHaveAttribute("data-testid", "overview-doc-doc-updated")
		})
	})

	it("list sorts by created when sortBy is created", async () => {
		await renderSection(<RecentDocumentsSection mode="list" sortBy="created" />)

		await waitFor(() => {
			const docs = screen.getAllByTestId(/^overview-doc-/)
			expect(docs[0]).toHaveAttribute("data-testid", "overview-doc-doc-created")
		})
	})
})

describe("RecentCommentsSection", () => {
	it("summary shows total count", async () => {
		await renderSection(<RecentCommentsSection mode="summary" />)
		await waitFor(() => {
			expect(screen.getByTestId("overview-stat-comments")).toHaveTextContent(
				"5",
			)
		})
	})

	it("list renders comments without sort toggle", async () => {
		await renderSection(<RecentCommentsSection mode="list" />)

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-comment-comment-1"),
			).toBeInTheDocument()
		})

		expect(
			screen.queryByTestId("overview-comment-sort"),
		).not.toBeInTheDocument()
	})

	it("list renders inside the activity container", async () => {
		await renderSection(<RecentCommentsSection mode="list" />)

		await waitFor(() => {
			expect(
				screen.getByTestId("overview-activity-comments"),
			).toBeInTheDocument()
		})
	})
})
