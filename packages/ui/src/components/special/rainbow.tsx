import { cn } from "@hoardodile/ui/lib/utils"

import type { SpecialTagStyleConfig } from "./types"

function RainbowSurface({
	id,
	active,
}: {
	readonly id: string
	readonly active?: boolean
}) {
	const gradientId = `${id}-rainbow-gradient`
	return (
		<svg
			className={cn(
				"size-full",
				!active && "group-hover:[filter:brightness(1.08)]",
			)}
			width="100%"
			height="100%"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
		>
			<defs>
				<linearGradient
					id={gradientId}
					x1="0%"
					y1="0%"
					x2="100%"
					y2="0%"
					gradientTransform="rotate(30, 0.5, 0.5)"
				>
					<stop offset="0%" stopColor="#fbffca" />
					<stop offset="33%" stopColor="#baffbf" />
					<stop offset="66%" stopColor="#a7efff" />
					<stop offset="100%" stopColor="#ffabff" />
				</linearGradient>
			</defs>
			<rect
				width="100"
				height="100"
				fill={active ? "#005458" : `url(#${gradientId})`}
			/>
		</svg>
	)
}

export const rainbowConfig: SpecialTagStyleConfig = {
	render: RainbowSurface,
	default: {
		className: "font-bold dark:[text-shadow:0_0_5px_rgba(0,0,0,0.5)]",
		style: {
			color: "#ffffff",
			textShadow: "0 0 5px rgba(0, 0, 0, 0.2)",
			boxShadow: "inset 0 0 0 1px rgba(0, 247, 255, 0.1)",
		},
	},
	active: {
		style: {
			color: "#ffffff",
		},
	},
}
