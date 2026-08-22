import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Current-file index for the gallery. The index may be owned by the
 * caller (URL-driven, so the position survives a reload) or kept
 * internally; either way it is clamped to the loaded file count and
 * driven by the left/right arrow keys.
 *
 * Extracted from the view because "controlled or not, clamped, keyboard
 * bound" is a rule set, not markup — and inline it silently depended on
 * a stale `setIndex` closure through an incomplete effect dependency
 * list.
 */
export type GalleryIndexOptions = {
	readonly count: number
	/** Caller-owned index; pass together with {@link onChange}. */
	readonly value?: number
	readonly onChange?: (index: number) => void
}

export function useGalleryIndex(opts: GalleryIndexOptions): {
	readonly index: number
	readonly setIndex: (next: number) => void
} {
	const { count, value, onChange } = opts
	const controlled = value !== undefined && onChange !== undefined
	const [internalIndex, setInternalIndex] = useState(0)
	const rawIndex = controlled ? value : internalIndex
	const index = clampIndex(rawIndex, count)

	const setIndex = useCallback(
		(next: number) => {
			const clamped = clampIndex(next, count)
			if (controlled) onChange(clamped)
			else setInternalIndex(clamped)
		},
		[controlled, count, onChange],
	)

	// The listener is bound once; the ref keeps it reading the current
	// index and setter without resubscribing on every step.
	const stepRef = useRef<(delta: number) => void>(() => {})
	stepRef.current = (delta) => {
		setIndex(index + delta)
	}
	useEffect(function bindArrowKeys() {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "ArrowLeft") stepRef.current(-1)
			else if (e.key === "ArrowRight") stepRef.current(1)
		}
		window.addEventListener("keydown", handleKey)
		return () => window.removeEventListener("keydown", handleKey)
	}, [])

	return { index, setIndex }
}

function clampIndex(value: number, count: number): number {
	if (count === 0) return 0
	return Math.min(Math.max(value, 0), count - 1)
}
