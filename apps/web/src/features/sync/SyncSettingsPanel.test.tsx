import type { SyncRecord } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { SyncPageActions, SyncSettingsPanel } from "./SyncSettingsPanel"

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

const currentRecord: SyncRecord = {
	id: "rec-2",
	deviceId: "dev-laptop",
	recordedAt: 2_000_000,
	resourceCount: 42,
	characterCount: 10,
	documentCount: 5,
	commentCount: 12,
	tagCount: 8,
	trashCount: 2,
	storageBytes: 2048,
	resourceBytes: 1024,
	createdAt: 2_000_000,
}

const previousRecord: SyncRecord = {
	id: "rec-1",
	deviceId: "dev-laptop",
	recordedAt: 1_000_000,
	resourceCount: 39,
	characterCount: 10,
	documentCount: 5,
	commentCount: 13,
	tagCount: 8,
	trashCount: 1,
	storageBytes: 1024,
	resourceBytes: 512,
	createdAt: 1_000_000,
}

type SummaryShape = {
	readonly remindDays: number
	readonly devices: readonly {
		readonly device: typeof laptop
		readonly lastRecordedAt?: number
		readonly elapsedDays?: number
		readonly due: boolean
		readonly latestRecord?: SyncRecord
		readonly previousRecord?: SyncRecord
	}[]
}

function summaryOf(overrides: Partial<SummaryShape> = {}): SummaryShape {
	return {
		remindDays: 7,
		devices: [
			{
				device: laptop,
				lastRecordedAt: 2_000_000,
				elapsedDays: 9,
				due: true,
				latestRecord: currentRecord,
				previousRecord,
			},
		],
		...overrides,
	}
}

let summaryData: SummaryShape

const summaryHandler = vi.fn(() => summaryData)
const prefHandler = vi.fn(() => null)
const deviceCreateHandler = vi.fn(() => undefined)
const deviceUpdateHandler = vi.fn(() => undefined)
const deviceDeleteHandler = vi.fn(() => undefined)
const recordCreateHandler = vi.fn(() => undefined)

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"sync.summary": summaryHandler,
			"asyncPreference.get": prefHandler,
			"sync.deviceCreate": deviceCreateHandler,
			"sync.deviceUpdate": deviceUpdateHandler,
			"sync.deviceDelete": deviceDeleteHandler,
			"sync.recordCreate": recordCreateHandler,
		}),
	)
})

async function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	let utils!: ReturnType<typeof render>
	await act(async () => {
		utils = render(
			<QueryClientProvider client={queryClient}>
				<SyncPageActions />
				<SyncSettingsPanel />
			</QueryClientProvider>,
		)
	})
	return { utils, queryClient }
}

/** Waits until the summary query resolved and the device card rendered. */
async function waitForCard() {
	await waitFor(() => {
		expect(
			screen.getByTestId("sync-device-card-dev-laptop"),
		).toBeInTheDocument()
	})
}

describe("SyncSettingsPanel", () => {
	it("renders the config, the one-way tip and the empty devices state", async () => {
		summaryData = { remindDays: 7, devices: [] }
		await renderPanel()
		expect(screen.getByTestId("sync-remind-days")).toBeInTheDocument()
		await waitFor(() => {
			expect(screen.getByText(/no devices yet/i)).toBeInTheDocument()
		})
		expect(screen.getByTestId("sync-device-add")).toBeInTheDocument()
		expect(
			screen.getByText(/sync one-way: one master repository/i),
		).toBeInTheDocument()
	})

	it("adds a device through the dialog and clears the form", async () => {
		const user = userEvent.setup()
		summaryData = { remindDays: 7, devices: [] }
		await renderPanel()

		await user.click(screen.getByTestId("sync-device-add"))
		expect(
			screen.getByText(/synced automatically once added/i),
		).toBeInTheDocument()
		const confirm = screen.getByTestId("sync-device-add-confirm")
		expect(confirm).toBeDisabled()
		await user.type(screen.getByTestId("sync-device-name"), "Desktop")
		await user.type(screen.getByTestId("sync-device-notes"), "home rig")
		expect(confirm).toBeEnabled()
		await user.click(confirm)

		await waitFor(() => {
			expect(deviceCreateHandler).toHaveBeenCalledWith({
				name: "Desktop",
				notes: "home rig",
			})
		})
		await waitFor(() => {
			expect(
				screen.queryByTestId("sync-device-add-confirm"),
			).not.toBeInTheDocument()
		})
	})

	it("records the current state with one press", async () => {
		const user = userEvent.setup()
		summaryData = summaryOf()
		await renderPanel()
		await waitForCard()

		await user.click(screen.getByTestId("sync-record-dev-laptop"))
		await waitFor(() => {
			expect(recordCreateHandler).toHaveBeenCalledWith({
				deviceId: "dev-laptop",
			})
		})
	})

	it("shows the latest snapshot values with deltas against the previous one", async () => {
		summaryData = summaryOf()
		await renderPanel()
		await waitForCard()

		expect(screen.getByLabelText(/resources/i)).toHaveTextContent("42")
		expect(screen.getByText("+3")).toBeInTheDocument()
		expect(screen.getByText("+1")).toBeInTheDocument()
		expect(screen.getByText("+512 B")).toBeInTheDocument()
		expect(screen.getByText("+1 KB")).toBeInTheDocument()
		expect(screen.getByText("−1")).toBeInTheDocument()
		expect(screen.getByText(/last synced .*9 days ago/i)).toBeInTheDocument()
		expect(screen.getByText(/overdue · 9 days/i)).toBeInTheDocument()
	})

	it("marks the first snapshot instead of showing deltas", async () => {
		summaryData = summaryOf({
			devices: [
				{
					device: laptop,
					lastRecordedAt: 2_000_000,
					elapsedDays: 1,
					due: false,
					latestRecord: currentRecord,
				},
			],
		})
		await renderPanel()
		await waitForCard()

		expect(screen.getAllByText("First sync")).toHaveLength(8)
		expect(screen.queryByText("+3")).not.toBeInTheDocument()
	})

	it("renders the never-synced state when no snapshot exists", async () => {
		summaryData = summaryOf({
			devices: [{ device: laptop, due: true }],
		})
		await renderPanel()
		await waitForCard()

		expect(screen.getByText("Never synced")).toBeInTheDocument()
		expect(screen.queryByLabelText(/resources/i)).not.toBeInTheDocument()
	})

	it("edits the device name and notes through the edit dialog", async () => {
		const user = userEvent.setup()
		summaryData = summaryOf()
		await renderPanel()
		await waitForCard()
		await user.click(screen.getByTestId("sync-device-edit-dev-laptop"))
		await user.clear(screen.getByTestId("sync-edit-name"))
		await user.type(screen.getByTestId("sync-edit-name"), "Workstation")
		await user.click(screen.getByTestId("sync-device-save"))
		await waitFor(() => {
			expect(deviceUpdateHandler).toHaveBeenCalledWith({
				id: "dev-laptop",
				name: "Workstation",
				notes: "USB 4TB",
			})
		})
	})

	it("deletes the device through the confirm dialog", async () => {
		const user = userEvent.setup()
		summaryData = summaryOf()
		await renderPanel()
		await waitForCard()
		await user.click(screen.getByTestId("sync-device-delete-dev-laptop"))
		expect(screen.getByText("Delete Laptop?")).toBeInTheDocument()
		await user.click(screen.getByTestId("sync-device-delete-confirm"))
		await waitFor(() => {
			expect(deviceDeleteHandler).toHaveBeenCalledWith({ id: "dev-laptop" })
		})
	})
})
