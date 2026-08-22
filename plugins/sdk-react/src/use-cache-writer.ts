import { useEffect, useRef } from "react"
import { usePluginAPI } from "./context.tsx"

const DEFAULT_DEBOUNCE_MS = 500

/**
 * Persist a value to the per-resource plugin cache: debounced writes while
 * the value changes, plus a flush on `pagehide` / `beforeunload` / unmount
 * so no pending update is lost.
 *
 * Use this for reader positions, resume timestamps, and similar
 * continuously-changing state. Pass `undefined` as the value (or
 * `disabled: true`) to skip persistence while the real value is loading.
 */
export function useCacheWriter<T>(options: {
	readonly key: string
	readonly value: T | undefined
	readonly encode: (value: T) => string
	readonly disabled?: boolean
	readonly debounceMs?: number
}): void {
	const api = usePluginAPI()
	const {
		key,
		value,
		encode,
		disabled = false,
		debounceMs = DEFAULT_DEBOUNCE_MS,
	} = options
	const latestRef = useRef(value)
	latestRef.current = value
	const encodeRef = useRef(encode)
	encodeRef.current = encode

	useEffect(() => {
		if (disabled || value === undefined) return
		const timer = setTimeout(() => {
			const snap = latestRef.current
			if (snap === undefined) return
			api.setCache(key, encodeRef.current(snap))
		}, debounceMs)
		return () => clearTimeout(timer)
	}, [api, key, value, disabled, debounceMs])

	useEffect(() => {
		if (disabled) return
		function flush() {
			const snap = latestRef.current
			if (snap === undefined) return
			api.setCache(key, encodeRef.current(snap))
		}
		window.addEventListener("pagehide", flush)
		window.addEventListener("beforeunload", flush)
		return () => {
			window.removeEventListener("pagehide", flush)
			window.removeEventListener("beforeunload", flush)
			flush()
		}
		// api is structurally stable; flush reads the latest value via ref.
	}, [api, key, disabled])
}
