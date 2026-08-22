/**
 * React hook around {@link prefSync}. Returns the current localStorage
 * value (or `defaultValue` when missing) and a setter that writes
 * localStorage + queues server sync.
 *
 * The hook re-renders when:
 * - the same tab calls `prefSync.set` for this key
 * - a cross-tab `storage` event fires for this key
 * - the server sync queue overwrites localStorage on hydration
 */

import { useCallback, useMemo, useSyncExternalStore } from "react"
import type { Codec } from "@/features/prefs"
import { jsonCodec } from "@/features/prefs"
import { prefSync } from "@/lib/prefSync"

/** String-based prefSync hook. */
export function useStringPrefSync(
	key: string,
	defaultValue: string,
): readonly [string, (value: string) => void] {
	const subscribe = useCallback(
		function subscribe(callback: () => void) {
			return prefSync.subscribe(key, callback)
		},
		[key],
	)

	const getSnapshot = useCallback(
		function getSnapshot() {
			return prefSync.get(key) ?? defaultValue
		},
		[key, defaultValue],
	)

	const getServerSnapshot = useCallback(
		function getServerSnapshot() {
			return defaultValue
		},
		[defaultValue],
	)

	const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

	const setValue = useCallback(
		function setValue(next: string) {
			prefSync.set(key, next)
		},
		[key],
	)

	return [value, setValue] as const
}

/** Typed prefSync hook with codec support. */
export function usePrefSync<T>(
	key: string,
	defaultValue: T,
	codec: Codec<T> = jsonCodec<T>(),
): readonly [T, (value: T) => void] {
	const encodedDefault = useMemo(
		function computeEncodedDefault() {
			return codec.encode(defaultValue)
		},
		[codec, defaultValue],
	)

	const [raw, setRaw] = useStringPrefSync(key, encodedDefault)

	const value = useMemo(
		function decodeValue() {
			const decoded = codec.decode(raw)
			return decoded !== undefined ? decoded : defaultValue
		},
		[raw, codec, defaultValue],
	)

	const setValue = useCallback(
		function setValue(next: T) {
			setRaw(codec.encode(next))
		},
		[setRaw, codec],
	)

	return [value, setValue] as const
}
