import { type RefObject, useEffect, useRef, useState } from "react"

/**
 * Shared pinch/pan viewport gesture for media viewers. One finger pans,
 * two fingers zoom around their midpoint, a quick tap reports a click,
 * and a second quick tap reports a double tap. The transform is
 * `translate(x, y) scale(scale)` with the target's center as origin.
 */

export type ViewportTransform = {
	readonly x: number
	readonly y: number
	readonly scale: number
}

export type ViewportPoint = {
	readonly x: number
	readonly y: number
}

export type PinchPanOptions = {
	readonly target: RefObject<HTMLElement | null>
	readonly initial?: ViewportTransform
	readonly minScale?: number
	readonly maxScale?: number
	/** Max travel for a tap before it becomes a drag, in CSS pixels. */
	readonly tapThreshold?: number
	/** When this value changes, the viewport returns to `initial`. */
	readonly resetKey?: string | number
	readonly onChange?: (next: ViewportTransform) => void
	readonly onTap?: (point: ViewportPoint) => void
	readonly onDoubleTap?: (point: ViewportPoint) => void
}

const DEFAULT_TRANSFORM: ViewportTransform = { x: 0, y: 0, scale: 1 }

type ActivePointer = {
	readonly id: number
	readonly x: number
	readonly y: number
	readonly startX: number
	readonly startY: number
}

type GestureSession = {
	readonly pointers: ReadonlyMap<number, ActivePointer>
	readonly start: ViewportTransform
	readonly startDistance: number
	readonly startMidpoint: ViewportPoint
	moved: boolean
}

/**
 * Clamp a scale into the viewer's zoom range. Pure so tests can hold the
 * same arithmetic the DOM hook uses.
 */
export function clampViewportScale(
	scale: number,
	options: { readonly minScale: number; readonly maxScale: number },
): number {
	return Math.max(options.minScale, Math.min(options.maxScale, scale))
}

/** Pan a transform by screen-space pixels. */
export function panViewport(
	transform: ViewportTransform,
	delta: ViewportPoint,
): ViewportTransform {
	return { ...transform, x: transform.x + delta.x, y: transform.y + delta.y }
}

/**
 * Zoom `transform` to `nextScale` while keeping the content under
 * `anchor` (relative to the transform origin) visually fixed.
 */
export function zoomViewportAt(
	transform: ViewportTransform,
	anchor: ViewportPoint,
	nextScale: number,
	options: { readonly minScale: number; readonly maxScale: number },
): ViewportTransform {
	const scale = clampViewportScale(nextScale, options)
	const scaleDelta = scale - transform.scale
	return {
		scale,
		x: transform.x - anchor.x * scaleDelta,
		y: transform.y - anchor.y * scaleDelta,
	}
}

/** True when a press counts as a tap rather than a drag. */
export function isTapGesture(
	start: ViewportPoint,
	end: ViewportPoint,
	tapThreshold: number,
): boolean {
	return Math.hypot(end.x - start.x, end.y - start.y) < tapThreshold
}

export function usePinchPan(options: PinchPanOptions): {
	readonly transform: ViewportTransform
	readonly reset: () => void
} {
	const {
		target,
		initial = DEFAULT_TRANSFORM,
		minScale = 0.5,
		maxScale = 4,
		tapThreshold = 8,
		resetKey,
		onChange,
		onTap,
		onDoubleTap,
	} = options
	const [transform, setTransform] = useState<ViewportTransform>(initial)
	const initialRef = useRef(initial)
	initialRef.current = initial
	const transformRef = useRef(transform)
	transformRef.current = transform
	const sessionRef = useRef<GestureSession | null>(null)
	const lastTapRef = useRef<{
		readonly point: ViewportPoint
		readonly time: number
	} | null>(null)
	const boundsRef = useRef({ minScale, maxScale, tapThreshold })
	boundsRef.current = { minScale, maxScale, tapThreshold }

	function update(next: ViewportTransform) {
		setTransform(next)
		onChange?.(next)
	}

	function reset() {
		update({ ...DEFAULT_TRANSFORM })
	}

	useEffect(() => {
		if (resetKey === undefined) return
		update({ ...initialRef.current })
	}, [resetKey])

	useEffect(() => {
		const currentTarget = target.current
		if (currentTarget === null) return
		const element: HTMLElement = currentTarget

		function startPointer(event: PointerEvent): void {
			const current = transformRef.current
			const session = sessionRef.current
			if (session === null) {
				sessionRef.current = {
					pointers: new Map([[event.pointerId, activePointer(event)]]),
					start: current,
					startDistance: 0,
					startMidpoint: eventPoint(event),
					moved: false,
				}
				element.setPointerCapture(event.pointerId)
				return
			}
			const pointers = new Map(session.pointers)
			pointers.set(event.pointerId, activePointer(event))
			const entries = [...pointers.values()]
			if (entries.length >= 2) {
				const first = entries[0]
				const second = entries[1]
				if (first !== undefined && second !== undefined) {
					sessionRef.current = {
						pointers,
						start: current,
						startDistance: distance(first, second),
						startMidpoint: midpoint(first, second),
						moved: session.moved,
					}
				}
			}
			element.setPointerCapture(event.pointerId)
		}

		function movePointer(event: PointerEvent): void {
			const session = sessionRef.current
			if (session === null) return
			const pointers = new Map(session.pointers)
			pointers.set(
				event.pointerId,
				activePointer(event, session.pointers.get(event.pointerId)),
			)
			const entries = [...pointers.values()]
			if (entries.length === 0) return

			if (entries.length === 1) {
				const pointer = entries[0]
				if (pointer === undefined) return
				const delta = {
					x: pointer.x - pointer.startX,
					y: pointer.y - pointer.startY,
				}
				if (
					!isTapGesture(
						session.startMidpoint,
						pointer,
						boundsRef.current.tapThreshold,
					)
				) {
					session.moved = true
				}
				sessionRef.current = {
					...session,
					pointers,
					moved:
						session.moved ||
						movedBeyondTap(pointer, boundsRef.current.tapThreshold),
				}
				update(panViewport(session.start, delta))
				return
			}

			const first = entries[0]
			const second = entries[1]
			if (first === undefined || second === undefined) return
			const nextDistance = Math.max(1, distance(first, second))
			const ratio = nextDistance / Math.max(1, session.startDistance)
			const nextMidpoint = midpoint(first, second)
			const centerMidpoint = relativeMidpoint(element, nextMidpoint)
			const next = zoomViewportAt(
				session.start,
				centerMidpoint,
				session.start.scale * ratio,
				{
					minScale: boundsRef.current.minScale,
					maxScale: boundsRef.current.maxScale,
				},
			)
			sessionRef.current = { ...session, pointers, moved: true }
			update(next)
		}

		function endPointer(event: PointerEvent): void {
			const session = sessionRef.current
			if (session === null) return
			const pointers = new Map(session.pointers)
			pointers.delete(event.pointerId)
			if (pointers.size > 0) {
				sessionRef.current = { ...session, pointers }
				return
			}
			sessionRef.current = null
			if (!session.moved && session.pointers.size === 1) {
				const point = eventPoint(event)
				handleTap(point)
			}
		}

		function cancelPointer(event: PointerEvent): void {
			const session = sessionRef.current
			if (session === null) return
			const pointers = new Map(session.pointers)
			pointers.delete(event.pointerId)
			sessionRef.current = pointers.size > 0 ? { ...session, pointers } : null
		}

		function handleTap(point: ViewportPoint): void {
			onTap?.(point)
			const now = performance.now()
			const last = lastTapRef.current
			lastTapRef.current = { point, time: now }
			if (
				last !== null &&
				now - last.time < 300 &&
				Math.hypot(point.x - last.point.x, point.y - last.point.y) < 30
			) {
				lastTapRef.current = null
				onDoubleTap?.(point)
			}
		}

		element.addEventListener("pointerdown", startPointer)
		element.addEventListener("pointermove", movePointer)
		element.addEventListener("pointerup", endPointer)
		element.addEventListener("pointercancel", cancelPointer)
		return () => {
			element.removeEventListener("pointerdown", startPointer)
			element.removeEventListener("pointermove", movePointer)
			element.removeEventListener("pointerup", endPointer)
			element.removeEventListener("pointercancel", cancelPointer)
		}
	}, [target, onTap, onDoubleTap, onChange])

	return { transform, reset }
}

function activePointer(
	event: PointerEvent,
	start?: ActivePointer | ViewportPoint,
): ActivePointer {
	const origin = start ?? eventPoint(event)
	return {
		id: event.pointerId,
		x: event.clientX,
		y: event.clientY,
		startX: origin.x,
		startY: origin.y,
	}
}

function eventPoint(event: {
	readonly clientX: number
	readonly clientY: number
}): ViewportPoint {
	return { x: event.clientX, y: event.clientY }
}

function distance(a: ViewportPoint, b: ViewportPoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: ViewportPoint, b: ViewportPoint): ViewportPoint {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function movedBeyondTap(pointer: ActivePointer, tapThreshold: number): boolean {
	return (
		isTapGesture(
			{ x: pointer.startX, y: pointer.startY },
			{ x: pointer.x, y: pointer.y },
			tapThreshold,
		) === false
	)
}

function relativeMidpoint(
	element: HTMLElement,
	point: ViewportPoint,
): ViewportPoint {
	const rect = element.getBoundingClientRect()
	return {
		x: point.x - (rect.left + rect.width / 2),
		y: point.y - (rect.top + rect.height / 2),
	}
}
