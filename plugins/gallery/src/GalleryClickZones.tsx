import { useRef } from "react"
import {
	cursorForTapZone,
	exceedsTapTolerance,
	resolveTapZone,
} from "./tap-zones"

/**
 * Transparent overlay turning taps on the left / right thirds of the
 * image into page steps, with a neutral centre band. Drags are ignored
 * so panning a zoomed image never flips the page.
 */
export type GalleryClickZonesProps = {
	readonly onPrev: () => void
	readonly onNext: () => void
}

type PressTracker = {
	readonly x: number
	readonly y: number
	aborted: boolean
}

export function GalleryClickZones(props: GalleryClickZonesProps) {
	const { onPrev, onNext } = props
	const containerRef = useRef<HTMLDivElement>(null)
	const pressRef = useRef<PressTracker | undefined>(undefined)

	function zoneAt(
		clientX: number,
	): ReturnType<typeof resolveTapZone> | undefined {
		const root = containerRef.current
		if (root === null) return undefined
		const rect = root.getBoundingClientRect()
		return resolveTapZone(rect.width, clientX - rect.left)
	}

	function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
		if (e.pointerType === "mouse" && e.button !== 0) return
		pressRef.current = { x: e.clientX, y: e.clientY, aborted: false }
	}

	function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
		const tracker = pressRef.current
		if (tracker === undefined || tracker.aborted) return
		if (exceedsTapTolerance(e.clientX - tracker.x, e.clientY - tracker.y)) {
			tracker.aborted = true
		}
	}

	function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
		const tracker = pressRef.current
		pressRef.current = undefined
		if (tracker === undefined || tracker.aborted) return
		const zone = zoneAt(e.clientX)
		if (zone === "prev") onPrev()
		else if (zone === "next") onNext()
	}

	function handlePointerLeave() {
		pressRef.current = undefined
	}

	function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
		const root = containerRef.current
		const zone = zoneAt(e.clientX)
		if (root === null || zone === undefined) return
		root.style.cursor = cursorForTapZone(zone)
	}

	function handleMouseLeave() {
		const root = containerRef.current
		if (root === null) return
		root.style.cursor = "default"
	}

	return (
		<div
			ref={containerRef}
			className="absolute inset-0 z-0"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerLeave={handlePointerLeave}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
		/>
	)
}
