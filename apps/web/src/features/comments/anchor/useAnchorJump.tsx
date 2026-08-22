import type { ResAnchor } from "@hoardodile/schemas"
import { createContext, type ReactNode, useContext } from "react"

/**
 * Default behaviour to jump to a comment's anchor location. Readers
 * inject their own implementation via {@link AnchorJumpProvider} so
 * clicking the anchor chip in-reader scrolls the surface to the right
 * page / paragraph instead of navigating away. Outside a reader, the
 * default opens the resource detail page with the anchor data encoded
 * in the pluginState query param.
 */
export type AnchorJumpHandler = (anchor: ResAnchor) => void

const AnchorJumpContext = createContext<AnchorJumpHandler | undefined>(
	undefined,
)

export function AnchorJumpProvider(props: {
	readonly handler: AnchorJumpHandler
	readonly children: ReactNode
}) {
	return (
		<AnchorJumpContext.Provider value={props.handler}>
			{props.children}
		</AnchorJumpContext.Provider>
	)
}

/**
 * Resolve the anchor click handler in scope. Falls back to a route
 * navigation that lands on the resource detail page; the plugin's
 * resolveCommentAnchor handles interpretation of the anchor data
 * once the detail page loads.
 */
export function useAnchorJump(): AnchorJumpHandler {
	const ctx = useContext(AnchorJumpContext)
	if (ctx !== undefined) return ctx
	return defaultJump
}

function defaultJump(anchor: ResAnchor): void {
	const params = new URLSearchParams()
	if (anchor.data !== undefined) {
		params.set("pluginState", encodeURIComponent(JSON.stringify(anchor.data)))
	}
	window.location.href = `/resources/${anchor.resId}?${params.toString()}`
}
