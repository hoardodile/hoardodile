import { cn } from "@hoardodile/ui/lib/utils"

import type { SpecialTagStyleConfig } from "./types"

function GoldSurface({
	id,
	active,
}: {
	readonly id: string
	readonly active?: boolean
}) {
	const gradientId = `${id}-gold-gradient`
	return (
		<svg
			className={cn(
				"size-full",
				!active &&
					"[filter:brightness(1.1)] group-hover:[filter:brightness(1.16)]",
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
					<stop offset="10%" stopColor="#daa520" />
					<stop offset="30%" stopColor="#ffd700" />
					<stop offset="50%" stopColor="#f0e68c" />
					<stop offset="70%" stopColor="#ffd700" />
					<stop offset="90%" stopColor="#daa520" />
				</linearGradient>
			</defs>
			<rect
				width="100"
				height="100"
				fill={active ? "#8a6d1f" : `url(#${gradientId})`}
			/>
			{!active && (
				<rect
					x="0"
					y="0"
					width="100"
					height="8"
					fill="#ffffff"
					opacity="0.12"
				/>
			)}
		</svg>
	)
}

export const goldConfig: SpecialTagStyleConfig = {
	render: GoldSurface,
	default: {
		style: {
			color: "#725603",
			boxShadow: "inset 0 0 0 1px rgba(114, 86, 3, 0.2)",
		},
	},
	active: {
		style: {
			color: "#ffffff",
		},
	},
}
