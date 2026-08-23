import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/components/common/ThemeProvider"

const totalsMock = [
	{
		id: "t1",
		entityType: "resource" as const,
		entityId: "res-a",
		granularity: "all" as const,
		period: null,
		totalMs: 120_000,
		viewCount: 3,
		lastViewedAt: 1_000,
		updatedAt: 1_000,
	},
	{
		id: "t2",
		entityType: "resource" as const,
		entityId: "res-b",
		granularity: "all" as const,
		period: null,
		totalMs: 60_000,
		viewCount: 1,
		lastViewedAt: 900,
		updatedAt: 900,
	},
]

let totalsMockState = totalsMock

vi.mock("../api", () => ({
	usageKeys: {
		all: ["usage"],
		dashboard: (input?: unknown) => ["usage", "dashboard", input],
		trend: (input: unknown) => ["usage", "trend", input],
		dailySummary: (input: unknown) => ["usage", "dailySummary", input],
		totals: (input: unknown) => ["usage", "totals", input],
		totalsPage: (input: unknown) => ["usage", "totalsPage", input],
	},
	usageDashboardQueryOptions: (input?: unknown) => ({
		queryKey: ["usage", "dashboard", input],
		queryFn: () =>
			Promise.resolve({
				totalMs: 180_000,
				totalViews: 4,
				topResources: [],
				topCharacters: [],
				topDocuments: [],
				topPlugins: [],
				recentActivity: [],
			}),
	}),
	usageTrendQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "trend", input],
		queryFn: () =>
			Promise.resolve({
				granularity: "day",
				buckets: [{ period: "2026-06-14", totalMs: 180_000, sessionCount: 4 }],
			}),
	}),
	usageDailySummaryQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "dailySummary", input],
		queryFn: () =>
			Promise.resolve({
				date: "2026-06-14",
				totalMs: 0,
				sessionCount: 0,
				hourlyMs: Array.from({ length: 24 }, () => 0),
				hourlyLabels: Array.from(
					{ length: 24 },
					(_, hour) => `${String(hour).padStart(2, "0")}:00`,
				),
				topEntities: [],
			}),
	}),
	usageTotalsQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "totals", input],
		queryFn: () => Promise.resolve(totalsMockState),
	}),
	usageTotalsPageQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "totalsPage", input],
		queryFn: () =>
			Promise.resolve({
				rows: totalsMockState,
				total: totalsMockState.length,
				page: 1,
				size: 10,
			}),
	}),
}))

vi.mock("@/features/settings/datePrefs", () => ({
	useUsageTimeZones: () => ({
		timeZonePref: "UTC",
		resolvedTimeZone: "UTC",
	}),
	useDateFormatter: () => ({
		formatDateTime: (ts: number) => new Date(ts).toISOString(),
		formatDate: (ts: number) => new Date(ts).toISOString().slice(0, 10),
		formatDateTrait: () => "",
	}),
}))

vi.mock("@/features/res", () => ({
	resDetailCardQueryOptions: (id: string) => ({
		queryKey: ["resource", id],
		queryFn: () => Promise.resolve({ id, name: `Resource ${id}` }),
	}),
}))

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual("@tanstack/react-router")
	return {
		...actual,
		Link: ({
			children,
			...props
		}: {
			children: React.ReactNode
			to: string
		}) => <a href={props.to}>{children}</a>,
		useNavigate: () => vi.fn(),
	}
})

import { StatsShareSection } from "./StatsShareSection"

function Wrapper(props: { children: React.ReactNode }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>{props.children}</ThemeProvider>
		</QueryClientProvider>
	)
}

const defaultSearch = {
	range: "all" as const,
	platform: "all" as const,
	exposureMode: "direct" as const,
	shareMetric: "time" as const,
	entityType: "resource" as const,
}

describe("StatsShareSection", () => {
	beforeEach(() => {
		totalsMockState = totalsMock
	})

	it("renders ranked rows with duration and share percent when shareMetric is time", async () => {
		render(
			<StatsShareSection
				search={defaultSearch}
				range="all"
				platformFilter="all"
				exposureMode="direct"
				entityFilter="resource"
			/>,
			{ wrapper: Wrapper },
		)
		expect(await screen.findByText("66.7% · 2m")).toBeInTheDocument()
		expect(screen.getByText("33.3% · 1m")).toBeInTheDocument()
		expect(screen.getByText("1")).toBeInTheDocument()
		expect(screen.queryByText("3 views")).not.toBeInTheDocument()
	})

	it("renders ranked rows with view share percent and view counts when shareMetric is views", async () => {
		render(
			<StatsShareSection
				search={{ ...defaultSearch, shareMetric: "views" }}
				range="all"
				platformFilter="all"
				exposureMode="direct"
				entityFilter="resource"
			/>,
			{ wrapper: Wrapper },
		)
		expect(await screen.findByText("75% · 3 views")).toBeInTheDocument()
		expect(screen.getByText("25% · 1 view")).toBeInTheDocument()
		expect(screen.queryByText("2m")).not.toBeInTheDocument()
	})

	it("renders ranked rows for last7days instead of the empty state", async () => {
		render(
			<StatsShareSection
				search={{ ...defaultSearch, range: "last7days" }}
				range="last7days"
				platformFilter="all"
				exposureMode="direct"
				entityFilter="all"
			/>,
			{ wrapper: Wrapper },
		)
		expect(await screen.findAllByText("66.7% · 2m")).not.toHaveLength(0)
		expect(screen.queryByText("usage.leaderboard.empty")).toBeNull()
	})

	it("hides the share bar card when the period has no usage", async () => {
		totalsMockState = []
		render(
			<StatsShareSection
				search={{ ...defaultSearch, range: "all" }}
				range="all"
				platformFilter="all"
				exposureMode="direct"
				entityFilter="all"
			/>,
			{ wrapper: Wrapper },
		)
		await waitFor(() => {
			expect(screen.queryByTestId("usage-share-bar")).toBeNull()
		})
	})
})
