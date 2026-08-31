import type { RefObject } from "react"
import { useEffect, useState } from "react"

/**
 * Workbench fullscreen, mirroring the app's preview control
 * (`apps/web/src/features/res/components/ResPreviewDialog.tsx`): drive the
 * browser Fullscreen API against an externally-owned container ref. The
 * caller decides which element fullscreens — here the plugin iframe
 * container (`frameRef`), so the plugin fills the whole screen no matter
 * the presentation mode. Exit is via Esc; the toggle action is surfaced
 * from the menu bar.
 */
export type FullscreenAPI = {
	readonly isFullscreen: boolean
	readonly toggle: () => void
}

export function useContainerFullscreen(
	containerRef: RefObject<HTMLElement | null>,
): FullscreenAPI {
	const [isFullscreen, setIsFullscreen] = useState(false)
	useEffect(() => {
		function handleChange() {
			setIsFullscreen(document.fullscreenElement === containerRef.current)
		}
		document.addEventListener("fullscreenchange", handleChange)
		return () => document.removeEventListener("fullscreenchange", handleChange)
	}, [containerRef])
	function toggle() {
		const el = containerRef.current
		if (el === null) return
		if (document.fullscreenElement === el) {
			void document.exitFullscreen()
		} else {
			void el.requestFullscreen()
		}
	}
	return { isFullscreen, toggle }
}
