import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/components/common/ThemeProvider"

const dashboardMock = {
	totalMs: 3_600_000,
	totalViews: 5,
	topResources: [],
	topCharacters: [],
	topDocuments: [],
	topPlugins: [],
	recentActivity: [],
}

const trendMock = {
	granularity: "day" as const,
	buckets: [
		{ period: "2026-06-08", totalMs: 300_000, sessionCount: 1 },
		{ period: "2026-06-09", totalMs: 0, sessionCount: 0 },
		{ period: "2026-06-10", totalMs: 0, sessionCount: 0 },
		{ period: "2026-06-11", totalMs: 0, sessionCount: 0 },
		{ period: "2026-06-12", totalMs: 0, sessionCount: 0 },
		{ period: "2026-06-13", totalMs: 0, sessionCount: 0 },
		{ period: "2026-06-14", totalMs: 600_000, sessionCount: 2 },
	],
}

vi.mock("../api", () => ({
	usageKeys: {
		all: ["usage"],
		dashboard: (input?: unknown) => ["usage", "dashboard", input],
		trend: (input: unknown) => ["usage", "trend", input],
		dailySummary: (input: unknown) => ["usage", "dailySummary", input],
	},
	usageDashboardQueryOptions: (input?: unknown) => ({
		queryKey: ["usage", "dashboard", input],
		queryFn: () => Promise.resolve(dashboardMock),
	}),
	usageTrendQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "trend", input],
		queryFn: () => Promise.resolve(trendMock),
	}),
	usageDailySummaryQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "dailySummary", input],
		queryFn: () =>
			Promise.resolve({
				date: "2026-06-14",
				totalMs: 600_000,
				sessionCount: 2,
				hourlyMs: Array.from({ length: 24 }, () => 0),
				hourlyLabels: Array.from(
					{ length: 24 },
					(_, hour) => `${String(hour).padStart(2, "0")}:00`,
				),
				topEntities: [],
			}),
	}),
}))

vi.mock("@/features/settings/datePrefs", () => ({
	useUsageTimeZones: () => ({
		timeZonePref: "UTC",
		resolvedTimeZone: "UTC",
	}),
}))

import { StatsKpiRow } from "./StatsKpiRow"

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

describe("StatsKpiRow", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
	})

	it("renders total watch time", async () => {
		render(<StatsKpiRow range="last7days" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		expect(await screen.findByTestId("stats-kpi-total-time")).toHaveTextContent(
			"15m",
		)
		expect(screen.queryByTestId("stats-kpi-sessions")).not.toBeInTheDocument()
	})
})
