import type { SyncSummary } from "@hoardodile/schemas"
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

const laptop = {
	id: "dev-laptop",
	name: "Laptop",
	notes: "USB 4TB",
	createdAt: 1_000_000,
	updatedAt: 1_000_000,
}
const phone = {
	id: "dev-phone",
	name: "Phone",
	notes: "",
	createdAt: 2_000_000,
	updatedAt: 2_000_000,
}
const laptopRecord = {
	id: "rec-1",
	deviceId: "dev-laptop",
	recordedAt: 1_000_000,
	resourceCount: 3,
	characterCount: 2,
	documentCount: 1,
	commentCount: 0,
	tagCount: 4,
	trashCount: 0,
	storageBytes: 4096,
	resourceBytes: 1024,
	createdAt: 1_000_000,
}

let summary: SyncSummary

const summaryHandler = vi.fn(() => summary)

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"sync.summary": summaryHandler,
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
	it("shows the permanent warning when no sync devices are configured", async () => {
		summary = { remindDays: 7, devices: [] }
		await renderBanner()
		await waitFor(() => {
			expect(screen.getByTestId("sync-warning-no-devices")).toBeInTheDocument()
		})
		expect(screen.getByText("No sync devices configured")).toBeInTheDocument()
		expect(
			screen.queryByTestId("sync-warning-due-dev-laptop"),
		).not.toBeInTheDocument()
	})

	it("shows one overdue alert per due device with the device name", async () => {
		summary = {
			remindDays: 7,
			devices: [
				{
					device: laptop,
					lastRecordedAt: 1_000_000,
					elapsedDays: 9,
					due: true,
					latestRecord: laptopRecord,
				},
				{
					device: phone,
					lastRecordedAt: 1_000_000,
					elapsedDays: 1,
					due: false,
					latestRecord: laptopRecord,
				},
			],
		}
		await renderBanner()
		await waitFor(() => {
			expect(
				screen.getByTestId("sync-warning-due-dev-laptop"),
			).toBeInTheDocument()
		})
		expect(
			screen.queryByTestId("sync-warning-no-devices"),
		).not.toBeInTheDocument()
		expect(
			screen.getByText("Laptop last synced 9 days ago"),
		).toBeInTheDocument()
		expect(
			screen.queryByTestId("sync-warning-due-dev-phone"),
		).not.toBeInTheDocument()
	})

	it("shows the never-synced reminder per device when no record exists yet", async () => {
		summary = {
			remindDays: 7,
			devices: [
				{ device: laptop, due: true },
				{
					device: phone,
					lastRecordedAt: 1_000_000,
					elapsedDays: 1,
					due: false,
					latestRecord: laptopRecord,
				},
			],
		}
		await renderBanner()
		await waitFor(() => {
			expect(
				screen.getByTestId("sync-warning-due-dev-laptop"),
			).toBeInTheDocument()
		})
		expect(screen.getByText("Laptop has never been synced")).toBeInTheDocument()
	})

	it("renders nothing when no device is due", async () => {
		summary = {
			remindDays: 7,
			devices: [
				{
					device: laptop,
					lastRecordedAt: 1_000_000,
					elapsedDays: 1,
					due: false,
					latestRecord: laptopRecord,
				},
				{
					device: phone,
					lastRecordedAt: 1_000_000,
					elapsedDays: 2,
					due: false,
					latestRecord: laptopRecord,
				},
			],
		}
		await renderBanner()
		await waitFor(() => {
			expect(summaryHandler).toHaveBeenCalled()
		})
		expect(
			screen.queryByTestId("sync-warning-no-devices"),
		).not.toBeInTheDocument()
		expect(
			screen.queryByTestId("sync-warning-due-dev-laptop"),
		).not.toBeInTheDocument()
	})
})
