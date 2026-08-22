import type { ChartData, ChartOptions } from "chart.js"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { formatDurationMs } from "@/lib/formatDuration"
import { useChartTheme } from "@/lib/useChartTheme"
import { BarChart, pickDurationYScale, withAlpha } from "./chartUtils"

type HourlyDistributionChartProps = {
	readonly data: readonly number[]
	readonly labels?: readonly string[]
}

export function HourlyDistributionChart(props: HourlyDistributionChartProps) {
	const { data, labels: labelsProp } = props
	const { t } = useTranslation()
	const colors = useChartTheme()

	const labels = useMemo(
		() =>
			labelsProp ??
			data.map((_, hour) => `${String(hour).padStart(2, "0")}:00`),
		[data, labelsProp],
	)

	// The busiest bar of the day is highlighted.
	const peakIndex = useMemo(() => {
		let best = 0
		let bestValue = data[0] ?? 0
		data.forEach((value, index) => {
			if (value > bestValue) {
				best = index
				bestValue = value
			}
		})
		return best
	}, [data])

	const chartData = useMemo<ChartData<"bar">>(
		() => ({
			labels: [...labels],
			datasets: [
				{
					label: t("usage.stats.totalTime"),
					data: [...data],
					backgroundColor: (context) =>
						withAlpha(
							colors.chart,
							context.dataIndex === peakIndex ? 0.7 : 0.2,
						),
					borderRadius: 2,
					borderSkipped: false,
					barPercentage: 0.5,
				},
			],
		}),
		[labels, data, colors, t, peakIndex],
	)

	// Dense hourly data labels every 6th bar.
	const labelStep = labels.length <= 6 ? 1 : labels.length <= 12 ? 2 : 6

	const { max, step } = useMemo(
		() => pickDurationYScale(Math.max(...data)),
		[data],
	)

	const options = useMemo<ChartOptions<"bar">>(
		() => ({
			responsive: true,
			maintainAspectRatio: false,
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
						callback: (_value, index) =>
							index % labelStep === 0 || index === labels.length - 1
								? labels[index]
								: "",
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
		[colors, labels, labelStep, max, step, t],
	)

	return (
		<div className="relative h-full w-full">
			<BarChart data={chartData} options={options} />
		</div>
	)
}
