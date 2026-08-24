import type {
	AnchorData,
	Danmaku,
	DanmakuListFilter,
	DanmakuMode,
	Message,
	PluginAssetDeleteResult,
	PluginDownloadRequest,
	PluginDownloadResult,
	PluginSchema,
} from "@hoardodile/sdk-types"
import { ensureHostBridge } from "./bridge.ts"
import type {
	InvalidateTarget,
	PluginFonts,
	PluginIframeContext,
	ReadFileRange,
} from "./protocol.ts"
import {
	broadcastPrefChange,
	getPluginCacheStore,
	getPluginPrefStore,
	seedPluginStores,
	setPluginCache,
	setPluginPref,
	snapshotCacheEntries,
} from "./stores.ts"
import type { FileUrlVariant, WebPluginAPI } from "./types.ts"
import {
	buildAssetUrl,
	buildFileUrl,
	buildFrameUrl,
	resolveFilesBaseUrl,
} from "./urls.ts"

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Narrow an unknown value to a plain record. Handy for decoding
 * plugin-defined payloads (e.g. anchor data) without assertion casts.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Extract `{ resolvedTheme, palette, iconStyle }` from an unknown host
 * payload. Malformed input yields `undefined` fields rather than throwing —
 * theme pushes are best-effort.
 */
export function extractThemePayload(data: unknown): {
	resolvedTheme: string | undefined
	palette: string | undefined
	iconStyle: string | undefined
} {
	if (!isRecord(data)) {
		return {
			resolvedTheme: undefined,
			palette: undefined,
			iconStyle: undefined,
		}
	}
	return {
		resolvedTheme:
			typeof data.resolvedTheme === "string" ? data.resolvedTheme : undefined,
		palette: typeof data.palette === "string" ? data.palette : undefined,
		iconStyle: typeof data.iconStyle === "string" ? data.iconStyle : undefined,
	}
}

/**
 * Extract the host app font payload (`family` + stylesheet paths) from
 * an unknown host push; `undefined` when the shape does not match.
 */
export function extractFontsPayload(data: unknown): PluginFonts | undefined {
	if (!isRecord(data) || typeof data.family !== "string") return undefined
	const cssPaths = Array.isArray(data.cssPaths)
		? data.cssPaths.filter((p): p is string => typeof p === "string")
		: []
	return { family: data.family, cssPaths }
}

/**
 * Extract a `{ key, value }` pref update from an unknown host push;
 * `undefined` when the shape does not match. `value` may be `undefined`
 * for a removal.
 */
export function extractPrefPayload(
	data: unknown,
): { readonly key: string; readonly value: string | undefined } | undefined {
	if (!isRecord(data)) return undefined
	const key = data.key
	if (typeof key !== "string") return undefined
	return {
		key,
		value: typeof data.value === "string" ? data.value : undefined,
	}
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Builds the full {@link WebPluginAPI} for a plugin running inside a sandboxed
 * iframe. Communicates with the host via postMessage.
 */
export function createIframeHostAPI<
	TSchema extends PluginSchema = PluginSchema,
>(ctx: PluginIframeContext): WebPluginAPI<TSchema> {
	const host = ensureHostBridge().withScope(ctx.resId)
	seedPluginStores(ctx)

	function logInfo(message: string, data?: Record<string, unknown>): void {
		host.request("logInfo", { message, data }).catch(() => {})
	}
	function logWarn(message: string, data?: Record<string, unknown>): void {
		host.request("logWarn", { message, data }).catch(() => {})
	}
	function logError(message: string, data?: Record<string, unknown>): void {
		host.request("logError", { message, data }).catch(() => {})
	}

	function listFiles(): Promise<readonly TSchema["file"][]> {
		return host.request("listFiles") as Promise<readonly TSchema["file"][]>
	}

	function readFile(path: string, range?: ReadFileRange): Promise<ArrayBuffer> {
		return host.request("readFile", { path, range })
	}

	function resolveFileUrl(filename: string, variant?: FileUrlVariant): string {
		return buildFileUrl(ctx.resId, filename, ctx.fileToken, variant)
	}

	function resolveExtractedUrl(path: string): string {
		return `/api/resources/${ctx.resId}/extracted/${encodeURIComponent(
			ctx.fileToken,
		)}/${encodeURIComponent(path)}`
	}

	function extractProgressUrl(): string {
		// The trailing slash carries the token segment the auth preHandler
		// strips (see apps/server/src/infra/http/plugin.ts).
		return `/api/resources/${ctx.resId}/extract-progress/${encodeURIComponent(
			ctx.fileToken,
		)}/`
	}

	function resolveBaseUrl(): string {
		return resolveFilesBaseUrl(ctx.resId, ctx.fileToken)
	}

	function resolveFrameUrl(filename: string, timeMs: number): string {
		return buildFrameUrl(ctx.resId, filename, timeMs, ctx.fileToken)
	}

	function listMessages(): Promise<readonly Message[]> {
		return host.request("listMessages")
	}

	function createMessage(input: {
		readonly body: string
		readonly anchor?: unknown
	}): Promise<Message> {
		// The plugin deals in raw location data; the wire anchor is the
		// `{ data }` envelope (the resource id is host state).
		return host.request("createMessage", {
			body: input.body,
			anchor: input.anchor === undefined ? undefined : { data: input.anchor },
		})
	}

	function listDanmaku(
		filter?: DanmakuListFilter,
	): Promise<readonly Danmaku[]> {
		return host.request("listDanmaku", { filter })
	}

	function createDanmaku(input: {
		readonly text: string
		readonly anchor: unknown
		readonly mode?: DanmakuMode
	}): Promise<Danmaku> {
		return host.request("createDanmaku", {
			text: input.text,
			anchor: { data: input.anchor },
			mode: input.mode,
		})
	}

	function getPref(key: string): string | undefined {
		return getPluginPrefStore().get(key) ?? undefined
	}

	function setPref(key: string, value: string): void {
		setPluginPref(key, value)
		broadcastPrefChange(key)
		host.request("setPref", { key, value }).catch(() => {})
	}

	function getCache(key: string): string | undefined {
		return getPluginCacheStore().get(key) ?? undefined
	}

	function setCache(key: string, value: string): void {
		setPluginCache(key, value)
		host.request("setCache", { key, value }).catch(() => {})
	}

	function listCache(): readonly {
		readonly key: string
		readonly value: string
	}[] {
		return snapshotCacheEntries()
	}

	function invalidate(target: InvalidateTarget): Promise<void> {
		return host.request("invalidate", { target })
	}

	function download(
		request: PluginDownloadRequest,
	): Promise<PluginDownloadResult> {
		// The protocol table declares the 5-minute ceiling (consent dialog
		// + transfer) — the bridge reads it; no per-call override here.
		return host.request("download", request)
	}

	function resolveAssetUrl(path: string): string {
		if (ctx.assetToken.length === 0) {
			throw new Error(
				'resolveAssetUrl() — the plugin has no asset token: declare "download": true in the manifest and reload the preview',
			)
		}
		return buildAssetUrl(ctx.pluginId, path, ctx.assetToken)
	}

	function deleteAsset(path: string): Promise<PluginAssetDeleteResult> {
		return host.request("deleteAsset", { path })
	}

	function onAnchorJump(cb: (anchor: AnchorData) => void): () => void {
		return host.subscribe("anchorJump", cb)
	}

	return {
		logInfo,
		logWarn,
		logError,
		resource: {
			id: ctx.resId,
			name: ctx.resName,
			sourceMeta: ctx.sourceMeta as TSchema["sourceMeta"],
			searchMeta: ctx.searchMeta as TSchema["searchMeta"],
			fileStats: ctx.fileStats,
			contentPluginId: ctx.contentPluginId,
		},
		listFiles,
		readFile,
		resolveFileUrl,
		resolveExtractedUrl,
		extractProgressUrl,
		resolveBaseUrl,
		resolveFrameUrl,
		download,
		resolveAssetUrl,
		deleteAsset,
		listMessages,
		createMessage,
		listDanmaku,
		createDanmaku,
		getPref,
		setPref,
		getCache,
		setCache,
		listCache,
		invalidate,
		onAnchorJump,
	} satisfies WebPluginAPI<TSchema>
}
