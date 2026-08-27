/**
 * The `pluginState` search value carried by anchor-jump navigation.
 *
 * The value is the anchor payload as arbitrary JSON (the host never
 * interprets its shape — plugins decode it themselves). When present it
 * is passed through untouched.
 *
 * Legacy URLs (pre-JSON-parameter migration) carried the payload as a
 * double-encoded string; after the router's single decode such a value
 * arrives as a string and is back-decoded here. Malformed values resolve
 * to `undefined` — a broken jump is a no-op, never a crash.
 */
export function decodeAnchorPluginState(state: unknown): unknown {
	if (typeof state !== "string") return state
	try {
		return JSON.parse(decodeURIComponent(state))
	} catch {
		return undefined
	}
}
