import { cn } from "@hoardodile/ui/lib/utils"

import type { SpecialTagStyleConfig } from "./types"

function OilslickSurface({
	id,
	active,
}: {
	readonly id: string
	readonly active?: boolean
}) {
	if (active) {
		return (
			<svg
				className={cn(
					"size-full",
					!active &&
						"[filter:saturate(1.15)] group-hover:[filter:saturate(1.3)_brightness(1.08)]",
				)}
				width="100%"
				height="100%"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
			>
				<rect width="100" height="100" fill="#1a1a2e" />
			</svg>
		)
	}

	const gradientA = `${id}-oilslick-a`
	const gradientB = `${id}-oilslick-b`
	const gradientC = `${id}-oilslick-c`

	return (
		<svg
			className={cn(
				"size-full",
				!active &&
					"[filter:saturate(1.15)] group-hover:[filter:saturate(1.3)_brightness(1.08)]",
			)}
			width="100%"
			height="100%"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
		>
			<defs>
				<radialGradient id={gradientA} cx="30%" cy="30%" r="70%">
					<stop offset="0%" stopColor="#8b5cf6">
						<animate
							attributeName="stop-color"
							values="#8b5cf6;#06b6d4;#8b5cf6"
							dur="8s"
							repeatCount="indefinite"
						/>
					</stop>
					<stop offset="60%" stopColor="#1e1b4b" stopOpacity="0.9" />
					<stop offset="100%" stopColor="#0f0f1a" stopOpacity="0" />
				</radialGradient>
				<radialGradient id={gradientB} cx="70%" cy="60%" r="60%">
					<stop offset="0%" stopColor="#10b981">
						<animate
							attributeName="stop-color"
							values="#10b981;#f59e0b;#ec4899;#10b981"
							dur="10s"
							repeatCount="indefinite"
						/>
					</stop>
					<stop offset="55%" stopColor="#1e1b4b" stopOpacity="0.8" />
					<stop offset="100%" stopColor="#0f0f1a" stopOpacity="0" />
				</radialGradient>
				<radialGradient id={gradientC} cx="50%" cy="80%" r="55%">
					<stop offset="0%" stopColor="#ec4899">
						<animate
							attributeName="stop-color"
							values="#ec4899;#8b5cf6;#06b6d4;#ec4899"
							dur="7s"
							repeatCount="indefinite"
						/>
					</stop>
					<stop offset="50%" stopColor="#1e1b4b" stopOpacity="0.7" />
					<stop offset="100%" stopColor="#0f0f1a" stopOpacity="0" />
				</radialGradient>
			</defs>

			<rect width="100" height="100" fill="#0a0a12" />
			<rect
				width="100"
				height="100"
				fill={`url(#${gradientA})`}
				opacity="0.85"
			/>
			<rect
				width="100"
				height="100"
				fill={`url(#${gradientB})`}
				opacity="0.75"
			/>
			<rect
				width="100"
				height="100"
				fill={`url(#${gradientC})`}
				opacity="0.70"
			/>

			{/* Thin oily film highlights */}
			<path
				d="M -10 60 Q 25 45 50 60 T 110 55"
				fill="none"
				stroke="#ffffff"
				strokeWidth="0.8"
				opacity="0.12"
			>
				<animate
					attributeName="d"
					values="M -10 60 Q 25 45 50 60 T 110 55;M -10 55 Q 30 70 55 50 T 110 65;M -10 60 Q 25 45 50 60 T 110 55"
					dur="12s"
					repeatCount="indefinite"
				/>
			</path>
		</svg>
	)
}

export const oilslickConfig: SpecialTagStyleConfig = {
	render: OilslickSurface,
	default: {
		style: {
			color: "#ffffff",
			boxShadow:
				"inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 0 10px rgba(139, 92, 246, 0.20)",
		},
	},
	active: {
		style: {
			color: "#ffffff",
		},
	},
}
