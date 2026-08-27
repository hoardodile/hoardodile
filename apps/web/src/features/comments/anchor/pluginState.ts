/**
 * The opaque `pluginState` search value carried by anchor-jump navigation.
 *
 * The value is the anchor payload JSON-stringified and URL-encoded one
 * extra time. The router's default search parser (a `JSON.parse` attempt
 * on every decoded value, see `@tanstack/router-core`) would otherwise
 * turn a plain JSON `pluginState` in the URL into an object on arrival,
 * silently failing the route's `z.string()` schema. The extra encoding
 * keeps the value a string end to end, so `resDetailSearchSchema` and the
 * URL bytes stay exactly what the pre-SPA navigation produced.
 */
export function encodeAnchorPluginState(data: unknown): string {
	return encodeURIComponent(JSON.stringify(data))
}

/**
 * Decode a URL-round-tripped `pluginState` value back to the anchor
 * payload. Malformed values (hand-edited URLs, legacy shapes) resolve to
 * `undefined` instead of throwing — a broken jump is a no-op, never a
 * crash.
 */
export function decodeAnchorPluginState(state: string): unknown {
	try {
		return JSON.parse(decodeURIComponent(state))
	} catch {
		return undefined
	}
}
