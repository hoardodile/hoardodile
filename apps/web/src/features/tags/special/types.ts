import type { CSSProperties, ReactElement } from "react"

export type SpecialTagSurfaceRendererProps = {
	readonly id: string
	readonly active?: boolean
}

export type SpecialTagSurfaceRenderer = (
	props: SpecialTagSurfaceRendererProps,
) => ReactElement

export type SpecialTagStyleAppearance = {
	readonly className?: string
	readonly style?: CSSProperties
}

export type SpecialTagStyleConfig = {
	readonly render: SpecialTagSurfaceRenderer
	readonly default: SpecialTagStyleAppearance
	readonly active?: SpecialTagStyleAppearance
}
