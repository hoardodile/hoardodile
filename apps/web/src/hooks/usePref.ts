import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"
import type { Codec } from "@/features/prefs"
import { jsonCodec } from "@/features/prefs"
import { asyncPrefQueryOptions } from "@/features/prefs/asyncPrefQuery"
import { scheduleAsyncPrefSet } from "@/features/prefs/asyncPrefSetScheduler"

/** Async typed pref hook with codec support. */
export function usePref<T>(
	key: string,
	defaultValue: T,
	codec: Codec<T> = jsonCodec<T>(),
): readonly [T, (value: T) => void] {
	const queryClient = useQueryClient()
	const query = useQuery(asyncPrefQueryOptions(key))

	const value = useMemo(
		function decodeValue() {
			const raw = query.data
			if (raw === null || raw === undefined) return defaultValue
			const decoded = codec.decode(raw)
			return decoded !== undefined ? decoded : defaultValue
		},
		[query.data, codec, defaultValue],
	)

	const setValue = useCallback(
		function setValue(next: T) {
			scheduleAsyncPrefSet(key, codec.encode(next), queryClient)
		},
		[key, codec, queryClient],
	)

	return [value, setValue] as const
}
