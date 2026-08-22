import {
	QueryClient,
	QueryClientProvider,
	queryOptions,
} from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/components/common/ThemeProvider"
import { routeTree } from "@/routeTree.gen"
import { createTrpc, createTrpcClient } from "@/trpc/client"
import type { TraceReportInput, TraceTimelineInput } from "../api"
import type { TraceEvent } from "../lib/actionMeta"

const MOCK_NOW = new Date("2026-06-14T12:00:00Z")

const firstPage: readonly TraceEvent[] = [
	{
		id: "evt-1",
		action: "resource.import",
		entityType: "resource",
		entityId: "res-1",
		entityName: "Manga A",
		detail: { sourceName: "Site X", fileCount: 3 },
		createdAt: MOCK_NOW.getTime() - 60_000,
		platform: "web-pc",
	},
	{
		id: "evt-2",
		action: "resource.export",
		entityType: "resource",
		entityId: "res-2",
		entityName: "Model B",
		detail: { bulk: true },
		createdAt: MOCK_NOW.getTime() - 30_000,
		platform: "web-pc",
	},
	{
		id: "evt-3",
		action: "comment.vote.add",
		entityType: "comment",
		entityId: "cmt-1",
		entityName: "A very long message",
		detail: { kind: "dislike" },
		createdAt: MOCK_NOW.getTime() - 10_000,
		platform: "web-pc",
	},
	{
		id: "evt-4",
		action: "document.commit",
		entityType: "document",
		entityId: "doc-1",
		entityName: "Viewing Notes",
		detail: { versionNo: 3 },
		createdAt: MOCK_NOW.getTime() - 5_000,
		platform: "web-pc",
	},
	{
		id: "evt-5",
		action: "character.create",
		entityType: "character",
		entityId: "char-1",
		entityName: "Echo",
		detail: {},
		createdAt: MOCK_NOW.getTime() - 1_000,
		platform: "web-pc",
	},
]

/** Distinct events served for page 2, so tests can tell pages apart. */
const secondPage: readonly TraceEvent[] = [
	{
		id: "evt-6",
		action: "resource.import",
		entityType: "resource",
		entityId: "res-6",
		entityName: "Old Manga",
		detail: {},
		createdAt: MOCK_NOW.getTime() - 60_000 * 60,
		platform: "web-mobile",
	},
	{
		id: "evt-7",
		action: "document.commit",
		entityType: "document",
		entityId: "doc-2",
		entityName: "Draft Notes",
		detail: { versionNo: 2 },
		createdAt: MOCK_NOW.getTime() - 60_000 * 120,
		platform: "web-pc",
	},
]

let rowsMock: readonly TraceEvent[] = firstPage
let totalMock = firstPage.length
let failPagesMock: readonly number[] = []
let reportMock = {
	period: "2026-06-14",
	rows: [{ action: "resource.import" as const, count: 2 }],
}

vi.mock("../api", () => ({
	traceTimelineQueryOptions: vi.fn((input: TraceTimelineInput) =>
		queryOptions({
			queryKey: ["trace", "timeline", input] as const,
			queryFn: () => {
				if (failPagesMock.includes(input.page ?? 1)) {
					return Promise.reject(new Error("boom"))
				}
				return Promise.resolve({
					rows: input.page === 2 ? secondPage : rowsMock,
					total: totalMock,
				})
			},
		}),
	),
	traceReportQueryOptions: vi.fn((input: TraceReportInput) =>
		queryOptions({
			queryKey: ["trace", "report", input] as const,
			queryFn: () => Promise.resolve([reportMock]),
		}),
	),
}))

vi.mock("@/features/settings/datePrefs", () => ({
	useUsageTimeZones: () => ({
		timeZonePref: "UTC",
		resolvedTimeZone: "UTC",
	}),
}))

import { traceTimelineQueryOptions } from "../api"
import { TraceTimelinePage } from "./TraceTimelinePage"

function Wrapper(props: { children: React.ReactNode }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const trpcClient = createTrpcClient()
	const trpc = createTrpc(trpcClient, queryClient)
	const router = createRouter({
		routeTree,
		context: { queryClient, trpc },
		history: createMemoryHistory({ initialEntries: ["/footprints"] }),
		defaultPendingMs: 0,
	})
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<RouterContextProvider router={router}>
					{props.children}
				</RouterContextProvider>
			</ThemeProvider>
		</QueryClientProvider>
	)
}

describe("TraceTimelinePage", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		vi.setSystemTime(MOCK_NOW)
		rowsMock = firstPage
		totalMock = firstPage.length
		failPagesMock = []
		reportMock = {
			period: "2026-06-14",
			rows: [{ action: "resource.import", count: 2 }],
		}
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	it("renders grouped footprint rows with action labels, detail and links", async () => {
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		expect(await screen.findByText("Imported Manga A")).toBeInTheDocument()
		expect(screen.getByText("Exported Model B")).toBeInTheDocument()
		// Vote rows split on the recorded kind.
		expect(
			screen.getByText('Disliked message "A very long message"'),
		).toBeInTheDocument()
		// Batch badge + import provenance.
		expect(screen.getByText("Batch")).toBeInTheDocument()
		expect(screen.getByText(/From Site X/)).toBeInTheDocument()
		expect(screen.getByText(/3 files/)).toBeInTheDocument()
		// Resource rows link to the resource page; comment rows do not.
		expect(screen.getByTestId("trace-row-evt-1")).toHaveAttribute(
			"href",
			"/resources/res-1",
		)
		expect(screen.getByTestId("trace-row-evt-3")).not.toHaveAttribute("href")
		// Document and character rows link to their detail pages.
		expect(screen.getByTestId("trace-row-evt-4")).toHaveAttribute(
			"href",
			"/documents/doc-1",
		)
		expect(
			screen.getByText('Updated document "Viewing Notes"'),
		).toBeInTheDocument()
		expect(screen.getByTestId("trace-row-evt-5")).toHaveAttribute(
			"href",
			"/characters/char-1",
		)
		expect(screen.getByText('Created character "Echo"')).toBeInTheDocument()
		expect(screen.getByTestId("trace-day-2026-06-14")).toHaveTextContent(
			"Today",
		)
	})

	it("shows the period overview with the action count", async () => {
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		expect(await screen.findByTestId("trace-overview")).toBeInTheDocument()
		expect(screen.getByTestId("trace-kpi-count")).toHaveTextContent("2")
	})

	it("shows the empty state when there are no events", async () => {
		rowsMock = []
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		expect(await screen.findByText(/No footprints yet/)).toBeInTheDocument()
	})

	it("shows the footprint count from the timeline total", async () => {
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		expect(await screen.findByText("5 footprints")).toBeInTheDocument()
	})

	it("refetches with the selected entity group", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		await screen.findByText("Imported Manga A")

		await user.click(screen.getByTestId("trace-filter-resource"))

		const calls = vi.mocked(traceTimelineQueryOptions).mock.calls
		const lastInput = calls[calls.length - 1]?.[0]
		expect(lastInput?.entityType).toBe("resource")
		expect(lastInput?.action).toBeUndefined()
		expect(lastInput?.page).toBe(1)
	})

	it("passes the selected platform into the timeline query", async () => {
		render(<TraceTimelinePage platform="web-pc" />, { wrapper: Wrapper })
		await screen.findByText("Imported Manga A")

		const calls = vi.mocked(traceTimelineQueryOptions).mock.calls
		const lastInput = calls[calls.length - 1]?.[0]
		expect(lastInput?.platform).toBe("web-pc")
	})

	it("omits the platform filter when all platforms are selected", async () => {
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		await screen.findByText("Imported Manga A")

		const calls = vi.mocked(traceTimelineQueryOptions).mock.calls
		const lastInput = calls[calls.length - 1]?.[0]
		expect(lastInput?.platform).toBeUndefined()
	})

	it("shows the paginator and flips pages when there is more than one page", async () => {
		totalMock = 120
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		await screen.findByText("Imported Manga A")

		expect(screen.getByTestId("pagination-bar")).toBeInTheDocument()
		expect(screen.getByTestId("pagination-current")).toHaveTextContent("1")
		// The count label travels with the pager.
		expect(
			within(screen.getByTestId("pagination-bar")).getByText("120 footprints"),
		).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Next" }))

		const calls = vi.mocked(traceTimelineQueryOptions).mock.calls
		const lastInput = calls[calls.length - 1]?.[0]
		expect(lastInput?.page).toBe(2)

		// The list actually swaps to the fetched page's rows.
		expect(await screen.findByText("Imported Old Manga")).toBeInTheDocument()
		expect(screen.queryByText("Imported Manga A")).not.toBeInTheDocument()
		expect(screen.getByTestId("pagination-current")).toHaveTextContent("2")
	})

	it("surfaces a failed page fetch instead of silently keeping the old page", async () => {
		totalMock = 120
		failPagesMock = [2]
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		await screen.findByText("Imported Manga A")

		await user.click(screen.getByRole("button", { name: "Next" }))

		expect(
			await screen.findByText("Failed to load footprints"),
		).toBeInTheDocument()
	})

	it("hides the paginator when every footprint fits on one page", async () => {
		render(<TraceTimelinePage platform="all" />, { wrapper: Wrapper })
		await screen.findByText("Imported Manga A")

		expect(screen.queryByTestId("pagination-bar")).not.toBeInTheDocument()
	})
})
