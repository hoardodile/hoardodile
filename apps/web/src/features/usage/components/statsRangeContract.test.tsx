import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ThemeProvider } from "@/components/common/ThemeProvider"
import {
	formatDay,
	formatMonth,
	formatWeek,
	formatYear,
	type UsageRange,
} from "../lib/date"

/** Period total every mocked source reports — the leaderboard rows are
    built to sum to exactly this, so percentages must add up to ~100%. */
const DENOMINATOR = 360_000

function row(entityId: string, totalMs: number, viewCount: number) {
	return {
		id: `t-${entityId}`,
		entityType: "resource" as const,
		entityId,
		granularity: "all" as const,
		period: null,
		totalMs,
		viewCount,
		lastViewedAt: 1_000,
		updatedAt: 1_000,
	}
}

/** Each entity kind totals DENOMINATOR / 4, so the merged all-entity view
    equals the period total. */
const rowsByType: Record<string, ReturnType<typeof row>[]> = {
	resource: [row("res-a", 60_000, 1), row("res-b", 30_000, 1)],
	character: [row("char-a", 45_000, 1), row("char-b", 45_000, 1)],
	document: [row("doc-a", 90_000, 1)],
	plugin: [row("plugin-a", 90_000, 1)],
}

const totalsInputs: unknown[] = []

vi.mock("../api", () => ({
	usageKeys: {
		all: ["usage"],
		dashboard: (input?: unknown) => ["usage", "dashboard", input],
		trend: (input: unknown) => ["usage", "trend", input],
		dailySummary: (input: unknown) => ["usage", "dailySummary", input],
		totals: (input: unknown) => ["usage", "totals", input],
		totalsPage: (input: unknown) => ["usage", "totalsPage", input],
	},
	usageDashboardQueryOptions: () => ({
		queryKey: ["usage", "dashboard"],
		queryFn: () =>
			Promise.resolve({
				totalMs: DENOMINATOR,
				totalViews: 4,
				topResources: [],
				topCharacters: [],
				topDocuments: [],
				topPlugins: [],
				recentActivity: [],
			}),
	}),
	usageTrendQueryOptions: () => ({
		queryKey: ["usage", "trend"],
		queryFn: () =>
			Promise.resolve({
				granularity: "day",
				buckets: [
					{ period: "2026-08-09", totalMs: DENOMINATOR, sessionCount: 4 },
				],
			}),
	}),
	usageDailySummaryQueryOptions: () => ({
		queryKey: ["usage", "dailySummary"],
		queryFn: () =>
			Promise.resolve({
				date: "2026-08-09",
				totalMs: DENOMINATOR,
				sessionCount: 4,
				hourlyMs: Array.from({ length: 24 }, () => 0),
				hourlyLabels: Array.from(
					{ length: 24 },
					(_, hour) => `${String(hour).padStart(2, "0")}:00`,
				),
				topEntities: [],
			}),
	}),
	usageTotalsQueryOptions: (input: {
		entityType: string
		granularity: string
		period?: string
		from?: number
		to?: number
	}) => {
		totalsInputs.push(input)
		return {
			queryKey: ["usage", "totals", input],
			queryFn: () => Promise.resolve(rowsByType[input.entityType] ?? []),
		}
	},
	usageTotalsPageQueryOptions: (input: { entityType: string }) => ({
		queryKey: ["usage", "totalsPage", input],
		queryFn: () =>
			Promise.resolve({
				rows: rowsByType[input.entityType] ?? [],
				total: (rowsByType[input.entityType] ?? []).length,
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
}))

vi.mock("@/features/res", () => ({
	resDetailCardQueryOptions: (id: string) => ({
		queryKey: ["resource", id],
		queryFn: () => Promise.resolve({ id, name: `Resource ${id}` }),
	}),
}))

vi.mock("@/features/char", () => ({
	charDetailCardQueryOptions: () => ({
		queryKey: ["char"],
		queryFn: () => Promise.resolve({ name: "Character", updatedAt: 1 }),
	}),
}))

vi.mock("@/features/doc", () => ({
	docNodeViewQueryOptions: () => ({
		queryKey: ["doc"],
		queryFn: () => Promise.resolve({ node: { title: "Document" } }),
	}),
}))

vi.mock("@/features/plugin", () => ({
	pluginListAllQueryOptions: () => ({
		queryKey: ["plugins"],
		queryFn: () =>
			Promise.resolve([{ id: "plugin-a", manifest: { name: "Plugin A" } }]),
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
	entityType: "all" as const,
}

type TotalsInput = {
	readonly entityType?: string
	readonly granularity?: string
	readonly period?: string
	readonly from?: number
	readonly to?: number
}

/** Collect the leaderboard rows' percentages (the share-bar legend has no
    "·" so it never matches). */
function leaderboardPercentages(): number[] {
	return [...screen.getAllByText(/% · /)].map((el) => {
		const match = /^([\d.]+)%/.exec(el.textContent ?? "")
		if (match === null) throw new Error(`unparseable row: ${el.textContent}`)
		return Number.parseFloat(match[1] ?? "")
	})
}

const RANGE_EXPECTATIONS: {
	readonly range: UsageRange
	readonly check: (input: TotalsInput) => void
}[] = [
	{
		range: "today",
		check: (input) => {
			expect(input.granularity).toBe("day")
			expect(input.period).toBe(formatDay(Date.now(), "UTC"))
		},
	},
	{
		range: "last7days",
		check: (input) => {
			// Multi-day windows must pass explicit bounds — never the
			// all-time fallback that inflates percentages past 100%.
			expect(input.granularity).toBe("all")
			expect(input.from).toBeTypeOf("number")
			expect(input.to).toBeTypeOf("number")
			if (input.from !== undefined && input.to !== undefined) {
				expect(input.from).toBeLessThan(input.to)
			}
		},
	},
	{
		range: "thisWeek",
		check: (input) => {
			expect(input.granularity).toBe("week")
			expect(input.period).toBe(formatWeek(Date.now(), "UTC"))
		},
	},
	{
		range: "thisMonth",
		check: (input) => {
			expect(input.granularity).toBe("month")
			expect(input.period).toBe(formatMonth(Date.now(), "UTC"))
		},
	},
	{
		range: "thisYear",
		check: (input) => {
			expect(input.granularity).toBe("year")
			expect(input.period).toBe(formatYear(Date.now(), "UTC"))
		},
	},
	{
		range: "all",
		check: (input) => {
			expect(input.granularity).toBe("all")
			expect(input.period).toBeUndefined()
			expect(input.from).toBeUndefined()
			expect(input.to).toBeUndefined()
		},
	},
]

describe("stats range contract", () => {
	for (const { range, check } of RANGE_EXPECTATIONS) {
		it(`queries the ${range} window and keeps percentages at ~100%`, async () => {
			totalsInputs.length = 0
			render(
				<StatsShareSection
					search={{ ...defaultSearch, range }}
					range={range}
					platformFilter="all"
					exposureMode="direct"
					entityFilter="all"
				/>,
				{ wrapper: Wrapper },
			)

			// Rows render (not the empty state)…
			expect(await screen.findAllByText(/% · /)).not.toHaveLength(0)
			expect(screen.queryByText("usage.leaderboard.empty")).toBeNull()

			// …the totals queries carry the range's window…
			const input = totalsInputs[0] as TotalsInput
			expect(input).toBeDefined()
			check(input)

			// …and every row is a share of the period total.
			const percentages = leaderboardPercentages()
			expect(percentages.length).toBeGreaterThan(0)
			for (const percent of percentages) {
				expect(percent).toBeLessThanOrEqual(100)
			}
			const sum = percentages.reduce((total, percent) => total + percent, 0)
			expect(sum).toBeGreaterThan(99)
			expect(sum).toBeLessThan(101)
		})
	}
})
