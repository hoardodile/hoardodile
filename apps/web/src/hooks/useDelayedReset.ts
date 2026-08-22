import { useCallback, useEffect, useRef } from "react"

/**
 * Schedule a reset callback so it runs after the default Radix/Tailwind
 * dialog exit animation finishes. Useful when a dialog's payload must stay
 * mounted during the close animation but should still be cleared once the
 * animation is done.
 *
 * @example
 *   const reset = useDelayedReset()
 *   function handleOpenChange(next: boolean) {
 *     setOpen(next)
 *     if (!next) reset.schedule(() => { setDraft(emptyDraft()) })
 *     else reset.cancel()
 *   }
 */
export type UseDelayedResetResult = {
	/** Cancel any pending reset without running it. */
	readonly cancel: () => void
	/**
	 * Schedule `fn` to run after the close animation. Cancels any previously
	 * scheduled reset first.
	 */
	readonly schedule: (fn: () => void) => void
}

const DEFAULT_CLOSE_DELAY_MS = 150

export function useDelayedReset(
	delayMs = DEFAULT_CLOSE_DELAY_MS,
): UseDelayedResetResult {
	const timeoutRef = useRef<number | null>(null)

	const cancel = useCallback(() => {
		if (timeoutRef.current !== null) {
			window.clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}
	}, [])

	const schedule = useCallback(
		(fn: () => void) => {
			cancel()
			timeoutRef.current = window.setTimeout(() => {
				timeoutRef.current = null
				fn()
			}, delayMs)
		},
		[cancel, delayMs],
	)

	useEffect(() => cancel, [cancel])

	return { cancel, schedule }
}
