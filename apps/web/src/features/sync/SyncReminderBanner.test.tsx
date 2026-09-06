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
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { SyncReminderBanner } from "./SyncReminderBanner"

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

function connection(
	id: string,
	name: string,
	receivedAt: number | null,
): Record<string, unknown> {
	return {
		id,
		name,
		lastSeenAt: 1,
		receivedPointId: null,
		receivedAt,
		receivedDataAt: 0,
	}
}

let peers: Record<string, unknown>[]
let source: Record<string, unknown> | null
let role: "unconfigured" | "send" | "receive"

const statusHandler = vi.fn(() => ({
	role,
	name: "Test",
	paused: false,
	source,
	peers,
	receiving: false,
	activeTransfers: 0,
}))

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"replication.status": statusHandler,
			// The health hook reads the reminder interval from the summary.
			"sync.summary": () => ({ remindDays: 7 }),
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

async function renderBanner() {
	const { router, queryClient } = createRouterWith(<SyncReminderBanner />)
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

describe("SyncReminderBanner", () => {
	it("shows the permanent warning when no device is connected", async () => {
		role = "unconfigured"
		source = null
		peers = []
		await renderBanner()
		await waitFor(() => {
			expect(screen.getByTestId("sync-warning-no-devices")).toBeInTheDocument()
		})
		expect(
			screen.getByText("No sync devices configured yet."),
		).toBeInTheDocument()
	})

	it("shows the attention banner when a connected device is due", async () => {
		role = "send"
		source = null
		peers = [
			connection("peer-1", "Backup drive", Date.now() - 10 * 86400_000),
			connection("peer-2", "Spare drive", Date.now()),
		]
		await renderBanner()
		await waitFor(() => {
			expect(screen.getByTestId("sync-warning-connections")).toBeInTheDocument()
		})
		expect(
			screen.queryByTestId("sync-warning-no-devices"),
		).not.toBeInTheDocument()
	})

	it("renders nothing when every connected device is up to date", async () => {
		role = "receive"
		source = { ...connection("peer-1", "Sender", Date.now()), url: "https://x" }
		peers = []
		await renderBanner()
		await waitFor(() => {
			expect(statusHandler).toHaveBeenCalled()
		})
		expect(
			screen.queryByTestId("sync-warning-no-devices"),
		).not.toBeInTheDocument()
		expect(
			screen.queryByTestId("sync-warning-connections"),
		).not.toBeInTheDocument()
	})
})
