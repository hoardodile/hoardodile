import { useCallback, useEffect, useRef } from "react"

const AUTOSAVE_DEBOUNCE_MS = 800

export type UseDocAutosaveResult = {
	/** Schedule a flush after the debounce window. Resets any pending timer. */
	readonly schedule: (flush: () => void) => void
	/** Cancel any pending autosave timer. */
	readonly cancel: () => void
}

/**
 * Debounced autosave timer for document drafts.
 *
 * The timer is scoped to a single hook instance; callers are responsible for
 * passing the correct flush function and for cancelling pending timers when
 * the document identity changes.
 */
export function useDocAutosave(enabled: boolean): UseDocAutosaveResult {
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const cancel = useCallback(() => {
		if (timer.current !== undefined) {
			clearTimeout(timer.current)
			timer.current = undefined
		}
	}, [])

	const schedule = useCallback(
		(flush: () => void) => {
			if (!enabled) return
			cancel()
			timer.current = setTimeout(() => {
				flush()
			}, AUTOSAVE_DEBOUNCE_MS)
		},
		[enabled, cancel],
	)

	useEffect(() => cancel, [cancel])

	// When autosave is switched off (user preference, offline mode, or an
	// unresolved conflict) any timer that was scheduled while it was on
	// must not fire — it would push a guarded-incompatible save.
	useEffect(() => {
		if (!enabled) cancel()
	}, [enabled, cancel])

	return { schedule, cancel }
}
