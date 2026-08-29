import { cn } from "@hoardodile/ui/lib/utils"

import type { SpecialTagStyleConfig } from "./types"

function SilverSurface({
	id,
	active,
}: {
	readonly id: string
	readonly active?: boolean
}) {
	const gradientId = `${id}-silver-gradient`
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
					<stop offset="10%" stopColor="#afaeae" />
					<stop offset="30%" stopColor="#d6d6d6" />
					<stop offset="50%" stopColor="#eeeeee" />
					<stop offset="70%" stopColor="#d6d6d6" />
					<stop offset="90%" stopColor="#afaeae" />
				</linearGradient>
			</defs>
			<rect
				width="100"
				height="100"
				fill={active ? "#5a5a5a" : `url(#${gradientId})`}
			/>
			{!active && (
				<rect
					x="0"
					y="0"
					width="100"
					height="8"
					fill="#ffffff"
					opacity="0.16"
				/>
			)}
		</svg>
	)
}

export const silverConfig: SpecialTagStyleConfig = {
	render: SilverSurface,
	default: {
		style: {
			color: "#2a2a2a",
			boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.08)",
		},
	},
	active: {
		style: {
			color: "#ffffff",
		},
	},
}
