import { imageVariantQuery } from "@hoardodile/sdk-types/image-variant"
import type { FileUrlVariant } from "./types.ts"

// ── File URL resolution ──────────────────────────────────────────────────
// Pure string builders: the iframe's null origin cannot send cookies, so
// the host embeds a short-lived token in the path (see
// apps/server/src/infra/http/plugin.ts). Kept side-effect free so the
// wire shape is unit-testable without the host bridge.

export function resolveFilesBaseUrl(resId: string, token: string): string {
	return `/api/resources/${resId}/files/${encodeURIComponent(token)}/`
}

/**
 * Build the URL for a resource file. Without `variant` (or with
 * `"original"`) the original bytes are addressed; `"preview"` selects
 * the default preview variant; an {@link ImageVariantSpec} requests a
 * custom derived image. Derived URLs always carry `size=preview` (the
 * compatibility alias) alongside the explicit variant parameters, so a
 * server that predates the generic contract degrades to its default
 * preview instead of silently serving the original.
 */
export function buildFileUrl(
	resId: string,
	filename: string,
	token: string,
	variant?: FileUrlVariant,
): string {
	const url = `/api/resources/${resId}/files/${encodeURIComponent(token)}/${encodeURIComponent(filename)}`
	if (variant === "preview") {
		return `${url}?size=preview`
	}
	if (variant !== undefined && variant !== "original") {
		return `${url}?${imageVariantQuery(variant)}`
	}
	return url
}

/** Build the URL for a video frame thumbnail at `timeMs`. */
export function buildFrameUrl(
	resId: string,
	filename: string,
	timeMs: number,
	token: string,
): string {
	const time = String(Math.max(0, Math.round(timeMs)))
	return `/api/resources/${resId}/frame/${encodeURIComponent(token)}/${encodeURIComponent(filename)}/${time}`
}

/**
 * Build the URL of a file in the plugin's own asset vault. The host
 * serves it via the tokenized `/api/plugin-assets/:id/:token/:path`
 * route (see `apps/server/src/infra/http/plugin-assets.ts`): `token` is
 * the plugin-scoped asset token from the iframe context — vault files
 * are host data, so they are served fresh (`no-cache`), never through
 * the service worker.
 */
export function buildAssetUrl(
	pluginId: string,
	path: string,
	token: string,
): string {
	return `/api/plugin-assets/${encodeURIComponent(pluginId)}/${encodeURIComponent(
		token,
	)}/${encodeURIComponent(path)}`
}
