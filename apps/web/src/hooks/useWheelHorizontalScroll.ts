import { useEffect } from "react"

/**
 * Translate vertical wheel input over a horizontal scroll container into
 * horizontal scrolling — native trackpad deltas pass through untouched.
 * The wheel is only claimed while the container overflows; at either end
 * it falls through to the page's vertical scroll. Native non-passive
 * listener, since React's `onWheel` cannot `preventDefault`.
 */
export function useWheelHorizontalScroll<T extends HTMLElement>(
	node: T | null,
) {
	useEffect(() => {
		if (node === null) return
		const container = node
		function handleWheel(event: WheelEvent) {
			if (container.scrollWidth <= container.clientWidth) return
			if (event.deltaX !== 0 || event.deltaY === 0) return
			const atStart = event.deltaY < 0 && container.scrollLeft <= 0
			const atEnd =
				event.deltaY > 0 &&
				container.scrollLeft >=
					container.scrollWidth - container.clientWidth - 1
			if (atStart || atEnd) return
			event.preventDefault()
			container.scrollLeft += event.deltaY
		}
		container.addEventListener("wheel", handleWheel, { passive: false })
		return () => container.removeEventListener("wheel", handleWheel)
	}, [node])
}
