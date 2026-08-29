import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Maximize, Minimize } from "@hoardodile/ui/icons/registry"
import type { RefObject } from "react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * Workbench fullscreen, mirroring the app's preview control
 * (`apps/web/src/features/res/components/ResPreviewDialog.tsx`): drive the
 * browser Fullscreen API against an externally-owned container ref. The
 * caller decides which element fullscreens — here the plugin iframe
 * container (`frameRef`), so the plugin fills the whole screen no matter
 * the presentation mode. Exit is via Esc (the toggle is outside the
 * fullscreen element), exactly like the app.
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

export function FullscreenButton(props: { readonly api: FullscreenAPI }) {
	const { t: tw } = useTranslation("workbench")
	const { isFullscreen, toggle } = props.api
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={tw(
				isFullscreen ? "toolbar.exitFullscreen" : "toolbar.enterFullscreen",
			)}
			onClick={toggle}
			data-testid="workbench-fullscreen"
		>
			<Icon icon={isFullscreen ? Minimize : Maximize} />
		</Button>
	)
}
