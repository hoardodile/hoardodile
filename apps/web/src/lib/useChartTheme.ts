import { useEffect, useState } from "react"
import { useTheme } from "@/components/common/ThemeProvider"

export type ChartThemeColors = {
	/** Data ink — the palette hue (`--color-chart`), falling back to
	    foreground ink in mono. */
	chart: string
	primary: string
	primaryTranslucent: string
	foreground: string
	mutedForeground: string
	border: string
	card: string
	background: string
}

const FALLBACK: ChartThemeColors = {
	chart: "oklch(0.7103 0.1483 233.8055)",
	primary: "oklch(0.7103 0.1483 233.8055)",
	primaryTranslucent: "oklch(0.7103 0.1483 233.8055 / 0.15)",
	foreground: "oklch(0.145 0 0)",
	mutedForeground: "oklch(0.556 0 0)",
	border: "oklch(0.922 0 0)",
	card: "oklch(1 0 0)",
	background: "oklch(1 0 0)",
}

function getCssVar(name: string): string {
	if (typeof document === "undefined") return ""
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim()
}

function withAlpha(color: string, alpha: number): string {
	if (!color) return `oklch(0 0 0 / ${alpha})`
	if (color.startsWith("oklch(")) {
		const inner = color.slice(6, -1).trim()
		return `oklch(${inner} / ${alpha})`
	}
	return color
}

function readColors(): ChartThemeColors {
	const primary = getCssVar("--primary") || FALLBACK.primary
	return {
		chart: getCssVar("--color-chart") || FALLBACK.chart,
		primary,
		primaryTranslucent: withAlpha(primary, 0.15),
		foreground: getCssVar("--foreground") || FALLBACK.foreground,
		mutedForeground:
			getCssVar("--muted-foreground") || FALLBACK.mutedForeground,
		border: getCssVar("--border") || FALLBACK.border,
		card: getCssVar("--card") || FALLBACK.card,
		background: getCssVar("--background") || FALLBACK.background,
	}
}

export function useChartTheme(): ChartThemeColors {
	const { resolvedTheme, palette } = useTheme()
	const [colors, setColors] = useState(readColors)

	useEffect(() => {
		setColors(readColors())
	}, [resolvedTheme, palette])

	return colors
}
