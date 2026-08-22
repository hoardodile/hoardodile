/**
 * @hoardodile/sdk-web — the pure-browser iframe runtime for hoardodile
 * content plugins. This is the only entry a framework-agnostic plugin
 * needs: the wire protocol (versioned via {@link PROTOCOL_VERSION}),
 * host bridge, stores, and theme/font/visibility helpers.
 *
 * The shared message/danmaku/anchor shapes re-exported at the top come
 * from `@hoardodile/sdk-types` — that package is the contract, this one
 * is the runtime. Plugin authors should import from
 * `@hoardodile/sdk-react` when using React, and only drop to this
 * package for framework-agnostic code. The browser-side host runtime
 * (`@hoardodile/host-web`) consumes this protocol, never redefines it.
 */

export type {
	AnchorData,
	Danmaku,
	DanmakuListFilter,
	DanmakuMode,
	FileStats,
	Message,
	ResAnchor,
} from "@hoardodile/sdk-types"
export type { ImageVariantSpec } from "@hoardodile/sdk-types/image-variant"
export { ensureHostBridge, isRecord } from "./bridge.ts"
export { booleanCodec, jsonCodec, numberCodec } from "./codecs.ts"
export {
	createWebPluginAPI,
	type DeepPartial,
	type StubbedPluginAPI,
} from "./fixtures.ts"
export {
	applyFonts,
	applyTheme,
	getPluginContext,
	getVisibilitySnapshot,
	mountPlugin,
	subscribeToVisibility,
} from "./lifecycle.ts"
export type {
	Host,
	HostMessage,
	HostPush,
	HostPushes,
	HostResponse,
	InvalidateTarget,
	PluginContextPainted,
	PluginFonts,
	PluginIframeContext,
	PluginMessage,
	PluginRequest,
	PluginRequests,
	PluginResolvedTheme,
	PluginSubscribe,
	PluginThemePalette,
	ReadFileRange,
	RequestInput,
	RequestOutput,
} from "./protocol.ts"
export {
	hostPushKeys,
	invalidatePushKeys,
	PROTOCOL_VERSION,
	pluginMethods,
	pluginThemePalettes,
} from "./protocol.ts"
export {
	createIframeHostAPI,
	extractFontsPayload,
	extractPrefPayload,
	extractThemePayload,
} from "./runtime.ts"
export {
	broadcastPrefChange,
	getPluginCacheStore,
	getPluginPrefStore,
	seedPluginStores,
	setPluginCache,
	setPluginPref,
	snapshotCacheEntries,
	subscribeToPrefChanges,
} from "./stores.ts"
export type {
	Codec,
	FileUrlVariant,
	MutationState,
	PluginResource,
	QueryState,
	ReactivePluginAPI,
	Theme,
	WebPluginAPI,
} from "./types.ts"
