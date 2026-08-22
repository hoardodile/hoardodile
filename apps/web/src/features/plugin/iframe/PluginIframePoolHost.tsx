import { useEffect } from "react"
import { setPoolContainer } from "./iframe-pool"

/**
 * Renders nothing in the React tree but creates a fixed-position container
 * under `document.body` where all plugin iframes live. This container is the
 * attach-point for {@link PluginIframePool}. Mount once at the app root.
 */
export function PluginIframePoolHost() {
	useEffect(() => {
		const el = document.createElement("div")
		el.id = "plugin-iframe-pool"
		// z-index:60 keeps the pool above Radix Dialog overlay/content (both z-50).
		// pointer-events:none on the container; each iframe opts back in.
		el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:60"
		document.body.appendChild(el)
		setPoolContainer(el)
		return () => {
			setPoolContainer(undefined)
			document.body.removeChild(el)
		}
	}, [])

	return null
}
