import type { UsageTotal } from "@hoardodile/schemas"
import { useQueries, useQuery } from "@tanstack/react-query"
import type { ChartData, ChartOptions } from "chart.js"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { charDetailCardQueryOptions } from "@/features/char"
import { docNodeViewQueryOptions } from "@/features/doc"
import { pluginListAllQueryOptions } from "@/features/plugin"
import { resDetailCardQueryOptions } from "@/features/res"
import { formatDurationMs } from "@/lib/formatDuration"
import { useChartTheme } from "@/lib/useChartTheme"
import { BarChart, pickDurationYScale, withAlpha } from "./chartUtils"

/** Rows shown on the today's-top-entities chart. */
const TOP_ENTITIES_LIMIT = 5

function hasName(data: unknown): data is { name: string } {
	return typeof data === "object" && data !== null && "name" in data
}

function hasNodeTitle(data: unknown): data is { node: { title: string } } {
	return (
		typeof data === "object" &&
		data !== null &&
		"node" in data &&
		typeof data.node === "object" &&
		data.node !== null &&
		"title" in data.node
	)
}

/** Resolve entity names for a list of totals rows (chart labels). */
function useEntityNames(
	rows: readonly UsageTotal[],
): readonly (string | undefined)[] {
	const pluginsQuery = useQuery({
		...pluginListAllQueryOptions(),
		enabled: rows.some((row) => row.entityType === "plugin"),
	})
	const queries = useQueries({
		queries: rows.map((row) => {
			if (row.entityType === "resource") {
				return resDetailCardQueryOptions(row.entityId)
			}
			if (row.entityType === "character") {
				return charDetailCardQueryOptions(row.entityId)
			}
			if (row.entityType === "document") {
				return docNodeViewQueryOptions(row.entityId)
			}
			return {
				queryKey: ["usage-entity-idle", row.entityId] as const,
				queryFn: async () => undefined,
				enabled: false,
			}
		}),
	})

	return rows.map((row, index) => {
		const data = queries[index]?.data
		if (row.entityType === "resource" || row.entityType === "character") {
			return hasName(data) ? data.name : undefined
		}
		if (row.entityType === "document") {
			return hasNodeTitle(data) ? data.node.title : undefined
		}
		return pluginsQuery.data?.find((plugin) => plugin.id === row.entityId)
			?.manifest.name
	})
}

type TopEntitiesChartProps = {
	readonly rows: readonly UsageTotal[]
}

/** Today's top entities as a horizontal bar chart (ink ramp). */
export function TopEntitiesChart(props: TopEntitiesChartProps) {
	const { t } = useTranslation()
	const colors = useChartTheme()
	const names = useEntityNames(props.rows)

	const visibleRows = props.rows.slice(0, TOP_ENTITIES_LIMIT)

	const labels = useMemo(
		() => visibleRows.map((row, index) => names[index] ?? row.entityId),
		[visibleRows, names],
	)

	const chartData = useMemo<ChartData<"bar">>(
		() => ({
			labels: [...labels],
			datasets: [
				{
					label: t("usage.stats.totalTime"),
					data: visibleRows.map((row) => row.totalMs),
					backgroundColor: withAlpha(colors.chart, 0.7),
					borderRadius: 2,
					borderSkipped: false,
					barPercentage: 0.6,
				},
			],
		}),
		[labels, visibleRows, colors, t],
	)

	const { max, step } = useMemo(
		() =>
			pickDurationYScale(Math.max(...visibleRows.map((row) => row.totalMs))),
		[visibleRows],
	)

	const options = useMemo<ChartOptions<"bar">>(
		() => ({
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: "y",
			plugins: {
				legend: { display: false },
				tooltip: {
					backgroundColor: colors.card,
					titleColor: colors.foreground,
					bodyColor: colors.foreground,
					borderColor: colors.border,
					borderWidth: 1,
					callbacks: {
						label: (context) => {
							const value = context.parsed.x
							return `${context.dataset.label}: ${
								typeof value === "number" ? formatDurationMs(value) : ""
							}`
						},
					},
				},
			},
			scales: {
				x: {
					grid: { color: colors.border },
					ticks: {
						color: colors.mutedForeground,
						font: { size: 12 },
						stepSize: step,
						callback: (value) => formatDurationMs(Number(value)),
					},
					max,
					border: { display: false },
				},
				y: {
					grid: { display: false },
					ticks: {
						color: colors.mutedForeground,
						font: { size: 12 },
					},
					border: { color: colors.border },
				},
			},
		}),
		[colors, t, max, step],
	)

	return (
		<div className="relative h-full w-full">
			<BarChart data={chartData} options={options} />
		</div>
	)
}
