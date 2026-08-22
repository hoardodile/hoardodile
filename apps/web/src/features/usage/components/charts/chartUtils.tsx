import type { ChartData, ChartOptions } from "chart.js"
import {
	BarController,
	BarElement,
	CategoryScale,
	Chart,
	Filler,
	LinearScale,
	LineController,
	LineElement,
	PointElement,
	Tooltip,
} from "chart.js"
import { useEffect, useRef } from "react"

// Register only the line/bar surface the app actually renders instead of
// chart.js/auto (which pulls in every controller, scale and plugin).
Chart.register(
	LineController,
	BarController,
	LineElement,
	PointElement,
	BarElement,
	LinearScale,
	CategoryScale,
	Tooltip,
	Filler,
)

export function withAlpha(color: string, alpha: number): string {
	if (!color) return `oklch(0 0 0 / ${alpha})`
	if (color.startsWith("oklch(")) {
		const inner = color.slice(6, -1).trim()
		return `oklch(${inner} / ${alpha})`
	}
	return color
}

/** Duration-friendly y steps: the first minute ramp step that yields
    2–3 gridlines wins. Returns the axis max and the tick step in
    milliseconds, so ticks land on whole minutes. */
const MINUTE_STEPS = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1440]

export function pickDurationYScale(maxMs: number): {
	readonly max: number
	readonly step: number
} {
	const maxMinutes = maxMs / 60_000
	for (const step of MINUTE_STEPS) {
		const count = Math.ceil(maxMinutes / step)
		if (count >= 2 && count <= 3) {
			return { max: step * count * 60_000, step: step * 60_000 }
		}
	}
	const step = Math.max(1, Math.ceil(maxMinutes / 3))
	return { max: step * 3 * 60_000, step: step * 60_000 }
}

export function LineChart(props: {
	readonly data: ChartData<"line">
	readonly options: ChartOptions<"line">
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const chartRef = useRef<Chart<"line"> | null>(null)

	useEffect(() => {
		if (!canvasRef.current) return
		const ctx = canvasRef.current.getContext("2d")
		if (!ctx) return

		const chart = new Chart(ctx, {
			type: "line",
			data: props.data,
			options: props.options,
		})
		chartRef.current = chart

		return () => {
			chart.destroy()
			chartRef.current = null
		}
	}, [])

	useEffect(() => {
		const chart = chartRef.current
		if (!chart) return
		chart.data = props.data
		chart.options = props.options
		chart.update()
	}, [props.data, props.options])

	return <canvas ref={canvasRef} />
}

export function BarChart(props: {
	readonly data: ChartData<"bar">
	readonly options: ChartOptions<"bar">
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const chartRef = useRef<Chart<"bar"> | null>(null)

	useEffect(() => {
		if (!canvasRef.current) return
		const ctx = canvasRef.current.getContext("2d")
		if (!ctx) return

		const chart = new Chart(ctx, {
			type: "bar",
			data: props.data,
			options: props.options,
		})
		chartRef.current = chart

		return () => {
			chart.destroy()
			chartRef.current = null
		}
	}, [])

	useEffect(() => {
		const chart = chartRef.current
		if (!chart) return
		chart.data = props.data
		chart.options = props.options
		chart.update()
	}, [props.data, props.options])

	return <canvas ref={canvasRef} />
}
