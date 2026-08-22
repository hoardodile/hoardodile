import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/components/common/ThemeProvider"

const defaultTrendMock = {
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

const emptyTrendMock = {
	granularity: "day" as const,
	buckets: Array.from({ length: 7 }, (_, index) => ({
		period: `2026-06-${String(8 + index).padStart(2, "0")}`,
		totalMs: 0,
		sessionCount: 0,
	})),
}

const defaultDailySummaryMock = {
	date: "2026-06-14",
	totalMs: 600_000,
	sessionCount: 2,
	hourlyMs: Array.from({ length: 24 }, (_, hour): number =>
		hour === 14 ? 600_000 : 0,
	),
	hourlyLabels: Array.from(
		{ length: 24 },
		(_, hour) => `${String(hour).padStart(2, "0")}:00`,
	),
	topEntities: [
		{
			id: "t1",
			entityType: "resource" as const,
			entityId: "res-a",
			granularity: "all" as const,
			period: null,
			totalMs: 600_000,
			viewCount: 2,
			lastViewedAt: 1,
			updatedAt: 1,
		},
	],
}

const emptyDailySummaryMock = {
	...defaultDailySummaryMock,
	hourlyMs: Array.from({ length: 24 }, (): number => 0),
	topEntities: [],
}

const defaultHourlyWindowMock = {
	dayCount: 7,
	hourlyMs: Array.from({ length: 24 }, (_, hour): number =>
		hour === 14 ? 600_000 : 0,
	),
	hourlyLabels: Array.from(
		{ length: 24 },
		(_, hour) => `${String(hour).padStart(2, "0")}:00`,
	),
}

const emptyHourlyWindowMock = {
	...defaultHourlyWindowMock,
	hourlyMs: Array.from({ length: 24 }, (): number => 0),
}

let trendMock = defaultTrendMock
let dailySummaryMock = defaultDailySummaryMock
let hourlyWindowMock = defaultHourlyWindowMock

vi.mock("../api", () => ({
	usageKeys: {
		all: ["usage"],
		trend: (input: unknown) => ["usage", "trend", input],
		dailySummary: (input: unknown) => ["usage", "dailySummary", input],
		hourlyWindow: (input: unknown) => ["usage", "hourlyWindow", input],
	},
	usageTrendQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "trend", input],
		queryFn: () => Promise.resolve(trendMock),
	}),
	usageDailySummaryQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "dailySummary", input],
		queryFn: () => Promise.resolve(dailySummaryMock),
	}),
	usageHourlyWindowQueryOptions: (input: unknown) => ({
		queryKey: ["usage", "hourlyWindow", input],
		queryFn: () => Promise.resolve(hourlyWindowMock),
	}),
}))

vi.mock("@/features/settings/datePrefs", () => ({
	useUsageTimeZones: () => ({
		timeZonePref: "UTC",
		resolvedTimeZone: "UTC",
	}),
}))

vi.mock("chart.js", () => {
	class FakeChart {
		data: unknown
		options: unknown
		update = vi.fn()
		destroy = vi.fn()
		static register = vi.fn()
		constructor(_ctx: unknown, config: { data: unknown; options: unknown }) {
			this.data = config.data
			this.options = config.options
		}
	}
	const noop = () => undefined
	return {
		Chart: FakeChart,
		BarController: noop,
		BarElement: noop,
		CategoryScale: noop,
		Filler: noop,
		LinearScale: noop,
		LineController: noop,
		LineElement: noop,
		PointElement: noop,
		Tooltip: noop,
	}
})

import { StatsChartsSection } from "./StatsChartsSection"

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

describe("StatsChartsSection", () => {
	beforeEach(() => {
		trendMock = defaultTrendMock
		dailySummaryMock = defaultDailySummaryMock
		hourlyWindowMock = defaultHourlyWindowMock
	})

	it("renders trend chart for last7days", async () => {
		render(<StatsChartsSection range="last7days" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		expect(await screen.findByText("Usage trend")).toBeInTheDocument()
	})

	it("hides trend chart when trend data is empty", async () => {
		trendMock = emptyTrendMock
		render(<StatsChartsSection range="last7days" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		await waitFor(() => {
			expect(screen.queryByText("Usage trend")).not.toBeInTheDocument()
		})
	})

	it("renders the daily rhythm card for multi-day ranges", async () => {
		render(<StatsChartsSection range="last7days" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		expect(await screen.findByText("Daily rhythm")).toBeInTheDocument()
	})

	it("hides the daily rhythm card when the window has no hourly data", async () => {
		hourlyWindowMock = emptyHourlyWindowMock
		render(<StatsChartsSection range="last7days" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		await waitFor(() => {
			expect(screen.queryByText("Daily rhythm")).not.toBeInTheDocument()
		})
	})

	it("renders hourly chart for today", async () => {
		render(<StatsChartsSection range="today" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		expect(await screen.findByText("Hourly distribution")).toBeInTheDocument()
	})

	it("hides hourly chart when hourly data is empty", async () => {
		dailySummaryMock = emptyDailySummaryMock
		render(<StatsChartsSection range="today" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		await waitFor(() => {
			expect(screen.queryByText("Hourly distribution")).not.toBeInTheDocument()
		})
	})

	it("renders the today's top entities card", async () => {
		render(<StatsChartsSection range="today" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		expect(await screen.findByText("Today's top entities")).toBeInTheDocument()
	})

	it("hides the top entities card when there are none", async () => {
		dailySummaryMock = { ...emptyDailySummaryMock, topEntities: [] }
		render(<StatsChartsSection range="today" platformFilter="all" />, {
			wrapper: Wrapper,
		})
		await waitFor(() => {
			expect(screen.queryByText("Today's top entities")).not.toBeInTheDocument()
		})
	})
})
