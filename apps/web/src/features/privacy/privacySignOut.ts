import type { AuthStatus } from "@hoardodile/schemas"
import type { QueryClient } from "@tanstack/react-query"
import { authStatusQueryKey, logout } from "@/features/auth"
import { channelNames } from "@/lib/keys"
import { clearLastRoute } from "@/lib/last-route"

export type AuthLogoutMessage = {
	readonly type: "logout"
}

/**
 * Open (once) the cross-tab auth broadcast channel. Every tab signs out
 * when any tab does, so a session that dies in one tab cannot leak into
 * another.
 */
let authChannel: BroadcastChannel | undefined

function getAuthChannel(): BroadcastChannel | undefined {
	if (authChannel !== undefined) return authChannel
	if (typeof BroadcastChannel === "undefined") return undefined
	authChannel = new BroadcastChannel(channelNames.auth)
	return authChannel
}

/** Notify other tabs that the session has been signed out. */
export function broadcastAuthLogout(): void {
	const channel = getAuthChannel()
	if (channel !== undefined) {
		channel.postMessage({ type: "logout" } satisfies AuthLogoutMessage)
	}
}

export function subscribeAuthLogout(listener: () => void): () => void {
	const channel = getAuthChannel()
	if (channel === undefined) return () => {}
	const handle = (event: MessageEvent<AuthLogoutMessage>) => {
		if (event.data?.type === "logout") listener()
	}
	channel.addEventListener("message", handle)
	return () => channel.removeEventListener("message", handle)
}

/**
 * Sign out the local session: clear the session cookie via the server,
 * wipe every cached query, mark the cached auth status as unauthenticated,
 * and broadcast to other tabs. Navigation to `/login` is left to the
 * caller (it owns its `useNavigate` instance).
 *
 * Server failures never block the local sign-out -- an unreachable server
 * must not keep the UI "logged in".
 */
export async function performSignOut(queryClient: QueryClient): Promise<void> {
	try {
		await logout()
	} catch {
		// Best-effort: the cookie is gone locally regardless.
	}
	// Drop all sensitive cached data (resource lists, documents, search)
	// before anything else so nothing survives the sign-out.
	const previous = queryClient.getQueryData<AuthStatus>(authStatusQueryKey)
	queryClient.clear()
	queryClient.setQueryData(authStatusQueryKey, {
		authenticated: false,
		configured: previous?.configured ?? true,
	})
	// An explicit sign-out must never restore the last page on the next
	// open — the desktop reopen continuity starts clean.
	clearLastRoute()
	broadcastAuthLogout()
}
