import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Hover-scrub frame preview for the progress slider: while the pointer
 * moves over the track, the current position is tracked live and the
 * frame thumbnail URL is fetched after a short debounce (the server
 * render costs a full decode, so it must not fire per mousemove).
 *
 * Kept as a hook so both control-bar variants (full bar and the thin
 * seek-only slider) share one behaviour instead of duplicating the
 * debounce + fetch dance.
 */

/** Frame-image fetch debounce, in milliseconds. */
const PREVIEW_FETCH_DEBOUNCE_MS = 150

/**
 * Map a pointer position inside a container to a media timestamp.
 * Pure and exported so the pointer→time geometry is unit-testable
 * without a DOM.
 */
export function previewTimeAt(
	clientX: number,
	containerLeft: number,
	containerWidth: number,
	durationMs: number,
): number {
	if (containerWidth <= 0 || durationMs <= 0) return 0
	const ratio = Math.max(
		0,
		Math.min(1, (clientX - containerLeft) / containerWidth),
	)
	return Math.round(ratio * durationMs)
}

export type ScrubPreview = {
	readonly visible: boolean
	readonly x: number
	readonly timeMs: number
	readonly imageUrl: string | undefined
	readonly onPointerMove: (rect: DOMRect, clientX: number) => void
	readonly hide: () => void
}

export function useScrubPreview(opts: {
	readonly durationMs: number
	/** Builds the frame-thumbnail URL; `undefined` disables the affordance. */
	readonly resolveFrameUrl?: (filename: string, timeMs: number) => string
	readonly filename?: string
}): ScrubPreview {
	const { durationMs, resolveFrameUrl, filename } = opts
	const [visible, setVisible] = useState(false)
	const [x, setX] = useState(0)
	const [timeMs, setTimeMs] = useState(0)
	const [imageUrl, setImageUrl] = useState<string | undefined>(undefined)
	const debounceRef = useRef<number | undefined>(undefined)

	// The debounced fetch and the pointer handler must not be recreated
	// per render (the slider re-renders on every `currentTime` tick);
	// a ref keeps the latest deps readable from stable callbacks.
	const latestRef = useRef({ durationMs, resolveFrameUrl, filename })
	latestRef.current = { durationMs, resolveFrameUrl, filename }

	const clearDebounce = useCallback(() => {
		if (debounceRef.current !== undefined) {
			window.clearTimeout(debounceRef.current)
			debounceRef.current = undefined
		}
	}, [])

	useEffect(() => clearDebounce, [clearDebounce])

	const onPointerMove = useCallback(
		(rect: DOMRect, clientX: number) => {
			const {
				durationMs: dur,
				resolveFrameUrl: resolve,
				filename: name,
			} = latestRef.current
			if (resolve === undefined || name === undefined) return
			setVisible(true)
			setX(clientX - rect.left)
			const nextTime = previewTimeAt(clientX, rect.left, rect.width, dur)
			setTimeMs(nextTime)
			clearDebounce()
			debounceRef.current = window.setTimeout(() => {
				setImageUrl(resolve(name, nextTime))
			}, PREVIEW_FETCH_DEBOUNCE_MS)
		},
		[clearDebounce],
	)

	const hide = useCallback(() => {
		setVisible(false)
		clearDebounce()
	}, [clearDebounce])

	return { visible, x, timeMs, imageUrl, onPointerMove, hide }
}
