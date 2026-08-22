import type {
	AnchorData,
	Danmaku,
	DanmakuListFilter,
	DanmakuMode,
	Message,
	PluginSchema,
} from "@hoardodile/sdk-types"
import type {
	Codec,
	Host,
	MutationState,
	PluginFonts,
	QueryState,
	ReactivePluginAPI,
	Theme,
} from "@hoardodile/sdk-web"
import {
	extractFontsPayload,
	extractPrefPayload,
	extractThemePayload,
	getPluginPrefStore,
	invalidatePushKeys,
	setPluginPref,
	subscribeToPrefChanges,
} from "@hoardodile/sdk-web"
import { useEffect, useMemo, useState } from "react"

// ── Query state helpers ──────────────────────────────────────────────────

function buildQuerySuccessState<T>(data: T): QueryState<T> {
	return { data, isLoading: false, isError: false, error: null }
}

function buildQueryErrorState(err: unknown): QueryState<never> {
	return {
		data: undefined,
		isLoading: false,
		isError: true,
		error: err instanceof Error ? err : new Error(String(err)),
	}
}

function buildQueryLoadingState(): QueryState<never> {
	return { data: undefined, isLoading: true, isError: false, error: null }
}

// ── Base query hook ──────────────────────────────────────────────────────

type PluginRequestKey = keyof import("@hoardodile/sdk-web").PluginRequests
type HostPushKey = keyof import("@hoardodile/sdk-web").HostPushes

type UseHostQueryOptions<K extends PluginRequestKey> = {
	readonly method: K
	readonly params: import("@hoardodile/sdk-web").RequestInput<K>
	readonly invalidateKey: HostPushKey
	readonly extraDeps?: readonly unknown[]
}

function useHostQuery<K extends PluginRequestKey, T>(
	host: Host,
	options: UseHostQueryOptions<K>,
): QueryState<T> {
	const { method, params, invalidateKey, extraDeps = [] } = options
	const [state, setState] = useState<QueryState<T>>(buildQueryLoadingState)

	useEffect(() => {
		let cancelled = false
		setState(buildQueryLoadingState())

		function fetchData() {
			const args = params === undefined ? [] : [params]
			host
				.request(method, ...(args as never))
				.then((result) => {
					if (!cancelled) {
						setState(buildQuerySuccessState(result as T))
					}
				})
				.catch((err: unknown) => {
					if (!cancelled) {
						setState(buildQueryErrorState(err))
					}
				})
		}

		fetchData()
		const unsub = host.subscribe(invalidateKey, fetchData as never)
		return function cleanup() {
			cancelled = true
			unsub()
		}
	}, [host, method, invalidateKey, ...extraDeps])

	return state
}

// ── File queries ─────────────────────────────────────────────────────────

function useFileList(host: Host, contextDeps: readonly unknown[]) {
	return useHostQuery<"listFiles", readonly string[]>(host, {
		method: "listFiles",
		params: undefined,
		invalidateKey: invalidatePushKeys.resource,
		extraDeps: contextDeps,
	})
}
// ── Message queries ──────────────────────────────────────────────────────

function useMessageList(host: Host, contextDeps: readonly unknown[]) {
	return useHostQuery<"listMessages", readonly Message[]>(host, {
		method: "listMessages",
		params: undefined,
		invalidateKey: invalidatePushKeys.messages,
		extraDeps: contextDeps,
	})
}

// ── Danmaku queries ───────────────────────────────────────────────────────

function useDanmakuList(
	host: Host,
	contextDeps: readonly unknown[],
	filter?: DanmakuListFilter,
) {
	return useHostQuery<"listDanmaku", readonly Danmaku[]>(host, {
		method: "listDanmaku",
		params: { filter },
		invalidateKey: invalidatePushKeys.danmaku,
		// The filter object is a fresh literal on every render; a stable
		// serialization keeps the effect from refetching in a loop while
		// still refetching when any filter value actually changes.
		extraDeps: [
			...contextDeps,
			filter === undefined ? undefined : JSON.stringify(filter),
		],
	})
}

// ── Mutations ────────────────────────────────────────────────────────────

function useHostMutation<
	K extends PluginRequestKey,
	TArgs extends import("@hoardodile/sdk-web").RequestInput<K>,
	TResult extends import("@hoardodile/sdk-web").RequestOutput<K>,
>(host: Host, method: K): MutationState<TArgs, TResult> {
	const [isPending, setIsPending] = useState(false)

	async function mutate(args: TArgs): Promise<TResult> {
		setIsPending(true)
		try {
			const requestArgs = args === undefined ? [] : [args]
			return (await host.request(
				method,
				...(requestArgs as never),
			)) as unknown as TResult
		} finally {
			setIsPending(false)
		}
	}

	return { mutate, isPending }
}

function useCreateMessage(
	host: Host,
): MutationState<
	{ readonly body: string; readonly anchor?: unknown },
	Message
> {
	const base = useHostMutation<
		"createMessage",
		{ readonly body: string; readonly anchor?: AnchorData },
		Message
	>(host, "createMessage")
	// The hook input is the raw plugin location data; the wire anchor is
	// the `{ data }` envelope (see sdk-web runtime).
	return {
		isPending: base.isPending,
		async mutate(input) {
			return base.mutate({
				body: input.body,
				anchor: input.anchor === undefined ? undefined : { data: input.anchor },
			})
		},
	}
}

function useCreateDanmaku(host: Host): MutationState<
	{
		readonly text: string
		readonly anchor: unknown
		readonly mode?: DanmakuMode
	},
	Danmaku
> {
	const base = useHostMutation<
		"createDanmaku",
		{
			readonly text: string
			readonly anchor: AnchorData
			readonly mode?: DanmakuMode
		},
		Danmaku
	>(host, "createDanmaku")
	return {
		isPending: base.isPending,
		async mutate(input) {
			return base.mutate({
				text: input.text,
				anchor: { data: input.anchor },
				mode: input.mode,
			})
		},
	}
}

// ── Preferences hook ─────────────────────────────────────────────────────

/** Serialize a typed value to its stored string form (codec or String()). */
function encodePrefValue<T>(codec: Codec<T> | undefined, value: T): string {
	return codec !== undefined ? codec.encode(value) : String(value)
}

/** Parse a stored string back to its typed form, falling back on malformed input. */
function decodePrefValue<T>(
	codec: Codec<T> | undefined,
	raw: string,
	fallback: T,
): T {
	if (codec === undefined) return raw as unknown as T
	const decoded = codec.decode(raw)
	return decoded !== undefined ? decoded : fallback
}

function usePref<T>(
	host: Host,
	key: string,
	defaultValue: T,
	codec?: Codec<T>,
): readonly [T, (value: T) => void] {
	const store = getPluginPrefStore()
	const encodedDefault = useMemo(
		function computeEncodedDefault() {
			return encodePrefValue(codec, defaultValue)
		},
		[codec, defaultValue],
	)

	const [raw, setRawState] = useState(function getInitial() {
		return store.get(key) ?? encodedDefault
	})

	useEffect(
		function subscribeToStoreChanges() {
			return subscribeToPrefChanges(key, function onChange() {
				setRawState(getPluginPrefStore().get(key) ?? encodedDefault)
			})
		},
		[key, encodedDefault],
	)

	useEffect(
		function subscribeToHostPush() {
			return host.subscribe("prefsChanged", function handlePrefPush(data) {
				const payload = extractPrefPayload(data)
				if (payload === undefined || payload.key !== key) return
				if (payload.value !== undefined) {
					setPluginPref(key, payload.value)
					setRawState(payload.value)
				} else {
					setRawState(encodedDefault)
				}
			})
		},
		[host, key, encodedDefault],
	)

	const value = useMemo(
		function decodeValue() {
			return decodePrefValue(codec, raw, defaultValue)
		},
		[raw, codec, defaultValue],
	)

	function setValue(next: T): void {
		const encoded = encodePrefValue(codec, next)
		setPluginPref(key, encoded)
		setRawState(encoded)
		host.request("setPref", { key, value: encoded }).catch(() => {})
	}

	return [value, setValue] as const
}

// ── Host push hooks ──────────────────────────────────────────────────────

/**
 * Subscribe to a host push and merge the extracted patch into state. The
 * extractor returns `undefined` (or an empty patch) when the push carries
 * no applicable change, so spurious pushes never re-render.
 */
function useHostPush<T>(
	host: Host,
	key: HostPushKey,
	extract: (data: unknown) => Partial<T> | undefined,
	initial: T,
): T {
	const [value, setValue] = useState(initial)

	useEffect(() => {
		const unsub = host.subscribe(key, function handlePush(data) {
			const patch = extract(data)
			if (patch !== undefined) {
				setValue((prev) => ({ ...prev, ...patch }))
			}
		})
		return function cleanup() {
			unsub()
		}
	}, [host, key, extract])

	return value
}

// ── Theme hook ───────────────────────────────────────────────────────────

function extractThemePatch(data: unknown): Partial<Theme> | undefined {
	const { resolvedTheme, palette, iconStyle } = extractThemePayload(data)
	if (
		resolvedTheme === undefined &&
		palette === undefined &&
		iconStyle === undefined
	) {
		return undefined
	}
	return {
		...(resolvedTheme !== undefined ? { resolvedTheme } : {}),
		...(palette !== undefined ? { palette } : {}),
		...(iconStyle !== undefined ? { iconStyle } : {}),
	}
}

function useTheme(
	host: Host,
	initialResolvedTheme: string,
	initialPalette: string,
	initialIconStyle: string,
): Theme {
	return useHostPush(host, "themeChanged", extractThemePatch, {
		resolvedTheme: initialResolvedTheme,
		palette: initialPalette,
		iconStyle: initialIconStyle,
	})
}

// ── Font hook ────────────────────────────────────────────────────────────

function useFont(host: Host, initialFonts: PluginFonts): PluginFonts {
	return useHostPush(host, "fontsChanged", extractFontsPayload, initialFonts)
}

// ── Public factory ───────────────────────────────────────────────────────

/**
 * Builds the reactive half of the plugin API (`useFileList`,
 * `useMessageList`, `useCreateMessage`, `useDanmakuList`,
 * `useCreateDanmaku`, `usePref`, `useTheme`, `useFont`) on top of the
 * imperative `WebPluginAPI` and the host bridge. Queries refetch
 * automatically on the matching host invalidation push and when the
 * iframe is rebound to another resource.
 *
 * Consumed by {@link createPluginRoot}; call it directly only when
 * composing your own runtime. The returned hooks are bound to the
 * `host` passed in — the one from `ensureHostBridge()`.
 */
export function createPluginQueryAPI<
	TSchema extends PluginSchema = PluginSchema,
>(
	host: Host,
	ctx: {
		readonly resolvedTheme: string
		readonly palette: string
		readonly iconStyle: string
		readonly fonts: PluginFonts
		readonly resId: string
	},
): ReactivePluginAPI<TSchema> {
	// Refetch when the iframe is rebound to another resource without a
	// remount (createPluginRoot's `remountOnResourceChange: false`). With
	// the default remount this dep is constant for the mount's lifetime.
	const contextDeps = [ctx.resId]
	return {
		useFileList: () =>
			useFileList(host, contextDeps) as QueryState<readonly TSchema["file"][]>,
		useMessageList: () => useMessageList(host, contextDeps),
		useCreateMessage: () => useCreateMessage(host),
		useDanmakuList: (filter?: DanmakuListFilter) =>
			useDanmakuList(host, contextDeps, filter),
		useCreateDanmaku: () => useCreateDanmaku(host),
		usePref: <T>(key: string, defaultValue: T, codec?: Codec<T>) =>
			usePref(host, key, defaultValue, codec),
		useTheme: () =>
			useTheme(host, ctx.resolvedTheme, ctx.palette, ctx.iconStyle),
		useFont: () => useFont(host, ctx.fonts),
	}
}
