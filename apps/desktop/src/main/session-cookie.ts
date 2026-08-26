import type { Session } from "electron"

/**
 * Per-launch sign-in. The sidecar sets exactly one cookie — the
 * `app_session` login cookie — and its sessions are stateless, so
 * dropping the cookies storage on boot is equivalent to signing out.
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
