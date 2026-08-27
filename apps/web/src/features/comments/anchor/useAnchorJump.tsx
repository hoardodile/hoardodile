import type { ResAnchor } from "@hoardodile/schemas"
import { useNavigate } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext } from "react"
import { encodeAnchorPluginState } from "./pluginState"

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
 * Resolve the anchor click handler in scope. Falls back to an in-app
 * route navigation that lands on the resource detail page (never a hard
 * reload); the detail page pushes the encoded anchor payload to the
 * plugin iframe once it is presented.
 */
export function useAnchorJump(): AnchorJumpHandler {
	const ctx = useContext(AnchorJumpContext)
	const navigate = useNavigate()
	if (ctx !== undefined) return ctx
	return (anchor) => {
		navigate({
			to: "/resources/$id",
			params: { id: anchor.resId },
			search: {
				pluginState:
					anchor.data !== undefined
						? encodeAnchorPluginState(anchor.data)
						: undefined,
			},
		})
	}
}
