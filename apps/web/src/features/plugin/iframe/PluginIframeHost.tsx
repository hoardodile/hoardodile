import { useEffect } from "react"
import { setIframeContainer } from "./iframe-instance"

/**
 * Renders nothing in the React tree but creates a fixed-position container
 * under `document.body` where all plugin iframes live. This container is the
 * attach-point for resource preview instances. Mount once at the app root.
 */
export function PluginIframeHost() {
	useEffect(() => {
		const el = document.createElement("div")
		el.id = "plugin-iframe-host"
		// z-index:60 keeps plugin previews above the dialog content (z-50).
		// pointer-events:none on the container; each iframe opts back in.
		el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:60"
		document.body.appendChild(el)
		setIframeContainer(el)
		return () => {
			setIframeContainer(undefined)
			document.body.removeChild(el)
		}
	}, [])

	return null
}
