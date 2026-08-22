import type { ChartData, ChartOptions } from "chart.js"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { formatDurationMs } from "@/lib/formatDuration"
import { useChartTheme } from "@/lib/useChartTheme"
import { formatDayPeriodLabel } from "../../lib/date"
import { LineChart, pickDurationYScale, withAlpha } from "./chartUtils"

type TrendChartProps = {
	readonly granularity: "day" | "week" | "month" | "year"
	readonly data: readonly {
		readonly period: string
		readonly totalMs: number
	}[]
	readonly timeZone: string
}

export function TrendChart(props: TrendChartProps) {
	const { granularity, data, timeZone } = props
	const { t } = useTranslation()
	const colors = useChartTheme()

	const formatted = useMemo(
		() =>
			data.map((bucket) => {
				const label =
					granularity === "day"
						? formatDayPeriodLabel(bucket.period, timeZone)
						: bucket.period
				return { label, totalMs: bucket.totalMs }
			}),
		[data, granularity, timeZone],
	)

	// The highlighted point sits on the latest bucket; the other points
	// stay invisible.
	const lastIndex = formatted.length - 1

	const chartData = useMemo<ChartData<"line">>(
		() => ({
			labels: formatted.map((item) => item.label),
			datasets: [
				{
					label: t("usage.stats.totalTime"),
					data: formatted.map((item) => item.totalMs),
					borderColor: colors.chart,
					backgroundColor: (context) => {
						const { chart } = context
						const { ctx, chartArea } = chart
						if (!chartArea) return withAlpha(colors.chart, 0.1)
						const gradient = ctx.createLinearGradient(
							0,
							chartArea.bottom,
							0,
							chartArea.top,
						)
						gradient.addColorStop(0, "transparent")
						gradient.addColorStop(1, withAlpha(colors.chart, 0.1))
						return gradient
					},
					fill: true,
					tension: 0.4,
					borderWidth: 1.5,
					pointRadius: (context) => (context.dataIndex === lastIndex ? 3 : 0),
					pointBackgroundColor: colors.chart,
					pointBorderColor: (context) =>
						context.dataIndex === lastIndex
							? withAlpha(colors.chart, 0.15)
							: colors.chart,
					pointBorderWidth: (context) =>
						context.dataIndex === lastIndex ? 4 : 0,
					pointHoverRadius: 4,
				},
			],
		}),
		[formatted, colors, t, lastIndex],
	)

	const { max, step } = useMemo(
		() =>
			pickDurationYScale(Math.max(...formatted.map((item) => item.totalMs))),
		[formatted],
	)

	const options = useMemo<ChartOptions<"line">>(
		() => ({
			responsive: true,
			maintainAspectRatio: false,
			interaction: { mode: "index", intersect: false },
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
							const value = context.parsed.y
							return `${context.dataset.label}: ${
								typeof value === "number" ? formatDurationMs(value) : ""
							}`
						},
					},
				},
			},
			scales: {
				x: {
					grid: { display: false },
					ticks: {
						color: colors.mutedForeground,
						font: { size: 12 },
					},
					border: { color: colors.border },
				},
				y: {
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
			},
		}),
		[colors, t, max, step],
	)

	return (
		<div className="relative h-full w-full">
			<LineChart data={chartData} options={options} />
		</div>
	)
}
