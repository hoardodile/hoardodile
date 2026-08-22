import { imageVariantQuery } from "@hoardodile/sdk-types/image-variant"
import type {
	FileUrlVariant,
	ReactivePluginAPI,
	WebPluginAPI,
} from "./types.ts"

/**
 * Deep-partial override type for {@link createWebPluginAPI}: nested
 * objects and functions can be overridden selectively; functions may
 * also be replaced by `undefined` to drop the default no-op.
 */
export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends (...args: never[]) => unknown
		? T[K] | undefined
		: T[K] extends object
			? DeepPartial<T[K]>
			: T[K]
}

/** The complete plugin API shape stubbed by {@link createWebPluginAPI}. */
export type StubbedPluginAPI = WebPluginAPI & ReactivePluginAPI

function mergeDeep<T extends object>(target: T, source: DeepPartial<T>): T {
	const result = { ...target }
	for (const key of Object.keys(source) as Array<keyof T>) {
		const sourceValue = source[key]
		const targetValue = result[key]
		if (
			sourceValue !== undefined &&
			typeof sourceValue === "object" &&
			!Array.isArray(sourceValue) &&
			targetValue !== undefined &&
			typeof targetValue === "object" &&
			!Array.isArray(targetValue)
		) {
			result[key] = mergeDeep(
				targetValue as object,
				sourceValue as DeepPartial<object>,
			) as T[keyof T]
		} else if (sourceValue !== undefined) {
			result[key] = sourceValue as T[keyof T]
		}
	}
	return result
}

/**
 * Returns a minimal complete plugin API for render tests — the imperative
 * surface plus no-op reactive hooks. All fields return empty/loading/no-op
 * values; override via `overrides` to exercise plugin-specific code paths.
 *
 * Framework-agnostic counterpart of the React `createWebPluginAPI` in
 * `@hoardodile/sdk-react`: this one returns a plain object (no React
 * provider), that one wraps the same stub in a `StubPluginAPIProvider`
 * so component tests can render against it.
 */
export function createWebPluginAPI(
	overrides?: DeepPartial<StubbedPluginAPI>,
): StubbedPluginAPI {
	const base: StubbedPluginAPI = {
		logInfo: () => {},
		logWarn: () => {},
		logError: () => {},
		resource: {
			id: "r-test",
			name: "test",
			sourceMeta: undefined,
			searchMeta: undefined,
			fileStats: undefined,
			contentPluginId: "p-test",
		},
		listFiles: async () => [],
		readFile: async () => new ArrayBuffer(0),
		resolveFileUrl: (filename, variant) => buildMockFileUrl(filename, variant),
		resolveExtractedUrl: (path) => `/extracted/${path}`,
		extractProgressUrl: () => "/extract-progress/",
		resolveBaseUrl: () => "/files/",
		resolveFrameUrl: (filename, timeMs) => `/frame/${filename}/${timeMs}`,
		listMessages: async () => [],
		createMessage: async () => {
			throw new Error("createMessage stub not overridden")
		},
		listDanmaku: async () => [],
		createDanmaku: async () => {
			throw new Error("createDanmaku stub not overridden")
		},
		getPref: () => undefined,
		setPref: () => {},
		getCache: () => undefined,
		setCache: () => {},
		listCache: () => [],
		invalidate: async () => {},
		onAnchorJump: () => () => {},
		useFileList: () => ({
			data: [],
			isLoading: false,
			isError: false,
			error: null,
		}),
		useMessageList: () => ({
			data: [],
			isLoading: false,
			isError: false,
			error: null,
		}),
		useCreateMessage: () => ({
			mutate: async () => {
				throw new Error("useCreateMessage stub not overridden")
			},
			isPending: false,
		}),
		useDanmakuList: () => ({
			data: [],
			isLoading: false,
			isError: false,
			error: null,
		}),
		useCreateDanmaku: () => ({
			mutate: async () => {
				throw new Error("useCreateDanmaku stub not overridden")
			},
			isPending: false,
		}),
		usePref: (_key, defaultValue, _codec) => [defaultValue, (_next) => {}],
		useTheme: () => ({
			resolvedTheme: "light",
			palette: "mono",
			iconStyle: "duotone",
		}),
		useFont: () => ({ family: "", cssPaths: [] }),
	}
	return overrides === undefined ? base : mergeDeep(base, overrides)
}

/**
 * Mock {@link WebPluginAPI.resolveFileUrl} shape: the same query the
 * real runtime emits for each variant (without the resId/token prefix).
 */
function buildMockFileUrl(filename: string, variant?: FileUrlVariant): string {
	const url = `/files/${filename}`
	if (variant === "preview") {
		return `${url}?size=preview`
	}
	if (variant !== undefined && variant !== "original") {
		return `${url}?${imageVariantQuery(variant)}`
	}
	return url
}
