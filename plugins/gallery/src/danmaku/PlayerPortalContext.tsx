import { createContext, useContext } from "react"

/**
 * Portal target for popovers/selects rendered inside the video player.
 * `undefined` keeps the default (`document.body`); the player provides
 * its own outer wrapper so popovers stay inside the fullscreen
 * element. Without this, fullscreen mode hides body-portalled content
 * behind the fullscreen surface and every tap registers as
 * outside-click, dismissing the popover before the user can interact.
 */
export const PlayerPortalContainerContext = createContext<
	HTMLElement | undefined
>(undefined)

export function usePlayerPortalContainer(): HTMLElement | undefined {
	return useContext(PlayerPortalContainerContext)
}
