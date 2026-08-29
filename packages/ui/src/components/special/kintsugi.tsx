import { cn } from "@hoardodile/ui/lib/utils"

import type { SpecialTagStyleConfig } from "./types"

function KintsugiSurface({
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
						"[filter:brightness(1.02)] group-hover:[filter:brightness(1.06)]",
				)}
				width="100%"
				height="100%"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
			>
				<rect width="100" height="100" fill="#9a9a8a" />
			</svg>
		)
	}

	const goldGradientId = `${id}-kintsugi-gold`

	return (
		<svg
			className={cn(
				"size-full",
				!active &&
					"[filter:brightness(1.02)] group-hover:[filter:brightness(1.06)]",
			)}
			width="100%"
			height="100%"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
		>
			<style>{`
				@keyframes ${id}-gold-shimmer {
					0% { stroke-dashoffset: 60; }
					100% { stroke-dashoffset: 0; }
				}
				.${id}-gold-vein {
					stroke-dasharray: 30 30;
					animation: ${id}-gold-shimmer 5s linear infinite;
				}
				@media (prefers-reduced-motion: reduce) {
					.${id}-gold-vein {
						animation: none;
					}
				}
			`}</style>

			<defs>
				<linearGradient id={goldGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#b8860b" />
					<stop offset="35%" stopColor="#ffd700" />
					<stop offset="50%" stopColor="#fffacd" />
					<stop offset="65%" stopColor="#ffd700" />
					<stop offset="100%" stopColor="#b8860b" />
				</linearGradient>
			</defs>

			{/* Celadon/cream ceramic base */}
			<rect width="100" height="100" fill="#d8d4c5" />
			<rect width="100" height="100" fill="#b8c4b8" opacity="0.35" />

			{/* Subtle surface texture */}
			<ellipse cx="30" cy="25" rx="40" ry="25" fill="#ffffff" opacity="0.08" />
			<ellipse cx="75" cy="70" rx="35" ry="28" fill="#000000" opacity="0.04" />

			{/* Crack lines (dark) */}
			<path
				d="M 5 20 Q 25 22 35 45 T 60 80"
				fill="none"
				stroke="#5a5650"
				strokeWidth="0.7"
				opacity="0.45"
			/>
			<path
				d="M 80 10 Q 70 35 85 55 T 55 95"
				fill="none"
				stroke="#5a5650"
				strokeWidth="0.6"
				opacity="0.40"
			/>
			<path
				d="M 10 70 Q 30 68 45 55 T 75 45"
				fill="none"
				stroke="#5a5650"
				strokeWidth="0.5"
				opacity="0.38"
			/>

			{/* Gold repair veins */}
			<path
				className={`${id}-gold-vein`}
				d="M 4 18 Q 24 20 34 43 T 58 78"
				fill="none"
				stroke={`url(#${goldGradientId})`}
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
			<path
				className={`${id}-gold-vein`}
				d="M 82 8 Q 72 33 87 53 T 53 93"
				fill="none"
				stroke={`url(#${goldGradientId})`}
				strokeWidth="1.2"
				strokeLinecap="round"
			/>
			<path
				className={`${id}-gold-vein`}
				d="M 8 68 Q 28 66 43 53 T 73 43"
				fill="none"
				stroke={`url(#${goldGradientId})`}
				strokeWidth="1.0"
				strokeLinecap="round"
			/>
		</svg>
	)
}

export const kintsugiConfig: SpecialTagStyleConfig = {
	render: KintsugiSurface,
	default: {
		style: {
			color: "#4a4030",
			boxShadow: "inset 0 0 0 1px rgba(74, 64, 48, 0.12)",
		},
	},
	active: {
		style: {
			color: "#ffffff",
		},
	},
}
