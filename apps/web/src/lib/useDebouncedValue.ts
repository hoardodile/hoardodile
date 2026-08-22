import { debounce } from "es-toolkit"
import { useEffect, useMemo, useState } from "react"

/**
 * Hold back `value` for `delayMs` of quiet before yielding the latest one.
 * Trailing-edge debounce: only the value that survives the quiet window is
 * returned; intermediate updates are discarded. Useful for keeping
 * downstream queries from firing on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value)
	const enqueue = useMemo(() => debounce(setDebounced, delayMs), [delayMs])
	useEffect(() => {
		enqueue(value)
		return () => enqueue.cancel()
	}, [value, enqueue])
	return debounced
}
