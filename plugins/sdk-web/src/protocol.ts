import type {
	FileStats,
	ReadFileRange,
	SearchMeta,
	SerializedFileList,
} from "@hoardodile/sdk-types"

/**
 * Wire protocol version shared between the plugin SDK and the browser
 * host. Bumped only on incompatible protocol changes. Plugins stamp every
 * outbound message with it; the host warns loudly when a plugin was built
 * against a different version.
 */
export const PROTOCOL_VERSION = 1 as const

/** Shared read-range contract; defined once in `@hoardodile/sdk-types`. */
export type { ReadFileRange } from "@hoardodile/sdk-types"

export type PluginResolvedTheme = "light" | "dark"

/**
 * Canonical list of theme palette ids — the single source of truth shared
 * by the host app and every plugin. `mono` is the default and has no CSS
 * class (it lives in `:root` / `.dark`); every other id maps to a
 * `.theme-<id>` block in `@hoardodile/ui/theme.css` and a
 * `theme.palette.<id>` i18n label.
 */
export const pluginThemePalettes = [
	"mono",
	"sage",
	"parchment",
	"azure",
	"hoardodile",
] as const

export type PluginThemePalette = (typeof pluginThemePalettes)[number]

/** Icon rendering style as chosen in host Settings → Icons. */
export type PluginIconStyle = "duotone" | "grayscale" | "linear"

/** Host app font as observed by the plugin. */
export type PluginFonts = {
	/** CSS `font-family` stack; empty when the plugin opted out of inheritance. */
	readonly family: string
	/** Absolute paths (`/fonts/...`) of the preset stylesheets backing the stack. */
	readonly cssPaths: readonly string[]
}

/**
 * Context injected into the iframe as `window.__context__` and pushed via
 * the `context` host push. Not a one-shot: the host may push a replacement
 * context at any time (a pooled iframe is rebound across resources without
 * a reload), and every push re-invokes the `mountPlugin` mount callback.
 */
export type PluginIframeContext = {
	readonly pluginId: string
	readonly resId: string
	readonly resName: string
	readonly sourceMeta: unknown
	readonly searchMeta: SearchMeta | undefined
	readonly fileStats: FileStats | undefined
	readonly contentPluginId: string
	/** Current UI language code. The iframe uses this to select its own locale bundle. */
	readonly language: string
	/** Current resolved theme (light or dark). */
	readonly resolvedTheme: PluginResolvedTheme
	/** Current theme palette. */
	readonly palette: PluginThemePalette
	/** Current icon rendering style (Settings → Icons). */
	readonly iconStyle: PluginIconStyle
	/**
	 * Host app font to apply inside the iframe: a CSS `font-family` stack
	 * plus the preset stylesheets that back it. An empty family means the
	 * plugin opted out (`ui.inheritFont: false`) and keeps its own fonts.
	 */
	readonly fonts: PluginFonts
	/** Initial plugin-scoped prefs (unprefixed keys) loaded from server. */
	readonly initialPrefs: Record<string, string>
	/** Initial plugin+resId cache entries (unprefixed keys) loaded from server. */
	readonly initialCache: Record<string, string>
	/**
	 * Short-lived token that lets the sandboxed iframe fetch resource files
	 * without a session cookie (null-origin iframe cannot send SameSite cookies).
	 */
	readonly fileToken: string
}

/** Wire request from plugin (iframe) to host. */
export type PluginRequest = {
	readonly type: "request"
	readonly id: number
	readonly method: string
	readonly params?: unknown
	/** Wire protocol version the plugin was built against (see {@link PROTOCOL_VERSION}). */
	readonly proto?: number
	/**
	 * SDK-internal scope stamp: the resource the request was issued for,
	 * captured by the runtime when the plugin called the API. The host
	 * drops the request as stale when the stamp no longer matches the
	 * iframe's binding (e.g. an unmount flush racing a rebind), so late
	 * requests never leak into the wrong resource. Plugin code never
	 * sets this.
	 */
	readonly resId?: string
}

/** Wire response from host to plugin for a prior request. */
export type HostResponse = {
	readonly type: "response"
	readonly id: number
	readonly ok: boolean
	readonly data?: unknown
	readonly error?: string
}

/** Wire push event from host to plugin. */
export type HostPush = {
	readonly type: "push"
	readonly key: string
	readonly data?: unknown
}

/** Wire subscription request from plugin to host. */
export type PluginSubscribe = {
	readonly type: "subscribe"
	readonly key: string
	/** Wire protocol version the plugin was built against (see {@link PROTOCOL_VERSION}). */
	readonly proto?: number
}

/**
 * Wire acknowledgement from plugin to host: the pushed context has been
 * applied *and painted* — the mount callback returned (for React plugins
 * the new tree is already committed via flushSync) and a frame with the
 * new content has reached the compositor. The host keeps a freshly
 * claimed pooled iframe transparent until this arrives, so the previous
 * resource's content never shows under a new claim.
 */
export type PluginContextPainted = {
	readonly type: "contextPainted"
	readonly resId: string
	/** Wire protocol version the plugin was built against (see {@link PROTOCOL_VERSION}). */
	readonly proto?: number
}

/** Union of all messages a plugin can send to the host. */
export type PluginMessage =
	| PluginRequest
	| PluginSubscribe
	| PluginContextPainted

/** Union of all messages the host can send to a plugin. */
export type HostMessage = HostResponse | HostPush

/** Type-safe request protocol table. Each entry declares input and output. */
export type PluginRequests = {
	logInfo: {
		readonly input: {
			readonly message: string
			readonly data?: Record<string, unknown>
		}
		readonly output: undefined
	}
	logWarn: {
		readonly input: {
			readonly message: string
			readonly data?: Record<string, unknown>
		}
		readonly output: undefined
	}
	logError: {
		readonly input: {
			readonly message: string
			readonly data?: Record<string, unknown>
		}
		readonly output: undefined
	}
	listFiles: {
		readonly input: undefined
		readonly output: SerializedFileList
	}
	readFile: {
		readonly input: {
			readonly path: string
			/** Byte range (see {@link ReadFileRange}); omitted = whole file. */
			readonly range?: ReadFileRange
		}
		readonly output: ArrayBuffer
	}
	listMessages: {
		readonly input: undefined
		readonly output: readonly import("@hoardodile/sdk-types").Message[]
	}
	createMessage: {
		readonly input: {
			readonly body: string
			/** Wire anchor envelope; plugins pass raw data, the SDK wraps it. */
			readonly anchor?: import("@hoardodile/sdk-types").AnchorData
		}
		readonly output: import("@hoardodile/sdk-types").Message
	}
	listDanmaku: {
		readonly input: {
			readonly filter?: import("@hoardodile/sdk-types").DanmakuListFilter
		}
		readonly output: readonly import("@hoardodile/sdk-types").Danmaku[]
	}
	createDanmaku: {
		readonly input: {
			readonly text: string
			/** Wire anchor envelope (see {@link PluginRequests.createMessage}). */
			readonly anchor: import("@hoardodile/sdk-types").AnchorData
			readonly mode?: import("@hoardodile/sdk-types").DanmakuMode
		}
		readonly output: import("@hoardodile/sdk-types").Danmaku
	}
	setPref: {
		/** Persist a plugin-wide preference; host broadcasts `prefsChanged`. */
		readonly input: { readonly key: string; readonly value: string }
		readonly output: undefined
	}
	setCache: {
		/**
		 * Persist a per-resource cache entry; host broadcasts
		 * `cacheChanged`.
		 */
		readonly input: {
			readonly key: string
			readonly value: string
		}
		readonly output: undefined
	}
	invalidate: {
		/** Request the host to invalidate cached data for a target. */
		readonly input: { readonly target: InvalidateTarget }
		readonly output: undefined
	}
}

/** Type-safe push protocol table. */
export type HostPushes = {
	context: PluginIframeContext
	visibility: { readonly visible: boolean }
	themeChanged: {
		readonly resolvedTheme: string
		readonly palette: string
		/** Active icon rendering style — host applies it as `data-icon-style`. */
		readonly iconStyle: PluginIconStyle
	}
	fontsChanged: PluginFonts
	languageChanged: { readonly language: string }
	prefsChanged: { readonly key: string; readonly value?: string }
	/**
	 * A plugin+resource cache entry changed. With data, carries the single
	 * changed entry; without data (undefined), all entries were cleared and
	 * the plugin should drop its whole cache store.
	 */
	cacheChanged:
		| { readonly resId: string; readonly key: string; readonly value?: string }
		| undefined
	/**
	 * Host-initiated request to jump to an anchor (e.g. the user clicked a
	 * comment anchor in the host UI). Carries the plugin-defined anchor data
	 * only — the resource is always the iframe's own.
	 */
	anchorJump: import("@hoardodile/sdk-types").AnchorData
	"res:invalidate": undefined
	"resources:invalidate": undefined
	"messages:invalidate": undefined
	"danmaku:invalidate": undefined
}

/** Extract the input type for a request key. */
export type RequestInput<K extends keyof PluginRequests> =
	PluginRequests[K]["input"]

/** Extract the output type for a request key. */
export type RequestOutput<K extends keyof PluginRequests> =
	PluginRequests[K]["output"]

/** Targets that can be invalidated from the plugin runtime. */
export type InvalidateTarget = "resource" | "resources" | "messages" | "danmaku"

// ── Runtime wire constants ─────────────────────────────────────────────────
//
// The type tables above are the protocol's single source of truth; these
// constants are their runtime mirror. The two are interlocked at compile
// time in both directions: a constant value that is not a table key fails
// `satisfies`, and a table key missing from the constant fails the
// `AssertTrue` checks below. Add a key to both or neither.

/** Wire keys for host→plugin pushes, mirroring {@link HostPushes}. */
export const hostPushKeys = {
	context: "context",
	visibility: "visibility",
	themeChanged: "themeChanged",
	fontsChanged: "fontsChanged",
	languageChanged: "languageChanged",
	prefsChanged: "prefsChanged",
	cacheChanged: "cacheChanged",
	anchorJump: "anchorJump",
	resInvalidate: "res:invalidate",
	resourcesInvalidate: "resources:invalidate",
	messagesInvalidate: "messages:invalidate",
	danmakuInvalidate: "danmaku:invalidate",
} as const satisfies Record<string, keyof HostPushes>

/** Wire method names for plugin→host requests, mirroring {@link PluginRequests}. */
export const pluginMethods = {
	// Files
	readFile: "readFile",
	listFiles: "listFiles",

	// Messages
	listMessages: "listMessages",
	createMessage: "createMessage",

	// Danmaku
	listDanmaku: "listDanmaku",
	createDanmaku: "createDanmaku",

	// Preferences / cache
	setPref: "setPref",
	setCache: "setCache",

	// Cache invalidation
	invalidate: "invalidate",

	// Logging — must match the PluginRequests keys exactly,
	// otherwise plugin log calls are silently swallowed.
	logInfo: "logInfo",
	logWarn: "logWarn",
	logError: "logError",
} as const satisfies Record<string, keyof PluginRequests>

/** Push key broadcast after each {@link InvalidateTarget} is invalidated. */
export const invalidatePushKeys = {
	resource: hostPushKeys.resInvalidate,
	resources: hostPushKeys.resourcesInvalidate,
	messages: hostPushKeys.messagesInvalidate,
	danmaku: hostPushKeys.danmakuInvalidate,
} as const satisfies Record<InvalidateTarget, keyof HostPushes>

/** Resolves to `T` only when `T` is `true`; otherwise a compile error. */
type AssertTrue<T extends true> = T

// Reverse coverage: every table key must appear as a constant value.
// Exported only so noUnusedLocals keeps these checks alive — never import.
export type _HostPushesCoveredByKeys = AssertTrue<
	keyof HostPushes extends (typeof hostPushKeys)[keyof typeof hostPushKeys]
		? true
		: false
>
export type _PluginRequestsCoveredByMethods = AssertTrue<
	keyof PluginRequests extends (typeof pluginMethods)[keyof typeof pluginMethods]
		? true
		: false
>

/**
 * Type-safe host bridge. The runtime still serialises messages as plain
 * postMessage objects; this contract gives compile-time guarantees to callers.
 */
export type Host = {
	request<K extends keyof PluginRequests>(
		method: K,
		...args: RequestInput<K> extends void ? [] : [RequestInput<K>]
	): Promise<RequestOutput<K>>
	subscribe<K extends keyof HostPushes>(
		key: K,
		handler: (data: HostPushes[K]) => void,
	): () => void
	/**
	 * Internal — returns a Host whose requests are stamped with the given
	 * resource scope (see {@link PluginRequest.resId}). Used by the runtime
	 * to bind one API instance to the resource it was created for.
	 */
	withScope: (resId: string) => Host
}
