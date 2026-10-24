import type { Session } from "electron"

/**
 * Require password verification again. The sidecar sets exactly one cookie — the
 * `app_session` login cookie — and its sessions are stateless, so
 * dropping cookies removes access. Non-secret continuity metadata separately
 * decides whether the renderer shows sign-in or unlock.
 * Scoped to the `cookies` storage only: localStorage and IndexedDB
 * (themes, offline drafts, plugin state) are user data and stay put
 * (same whitelist rule as `shell-cache.ts` — never an omnibus
 * `clearStorageData()`).
 */
export async function clearSessionCookies(
	session: Pick<Session, "clearStorageData">,
): Promise<void> {
	await session.clearStorageData({ storages: ["cookies"] })
}
