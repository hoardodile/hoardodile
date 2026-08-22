import type { AuthStatus } from "@hoardodile/schemas"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { authStatusQueryKey, authStatusQueryOptions } from "@/features/auth"
import { booleanCodec, numberCodec } from "@/features/prefs"
import { usePrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"
import { performSignOut, subscribeAuthLogout } from "./privacySignOut"

export const DEFAULT_AUTO_LOGOUT_DELAY_MS = 60_000

/**
 * Automatic session protection.
 *
 * - When the tab goes hidden, a timer is armed for the configured delay.
 *   If it fires before the tab is seen again, the session is signed out
 *   while still in the background (background-tab throttling may delay
 *   the timer, which is why the return-path check below is authoritative).
 * - When the tab becomes visible again: if the hidden duration exceeded
 *   the delay, sign out immediately; then (always) re-validate the
 *   session against the server so a session killed by another tab, by the
 *   server idle timeout, or by a cookie wipe cannot linger in this tab.
 * - bfcache restores are caught via `pageshow` (no `visibilitychange`
 *   fires on some platforms); frozen time still counts toward the delay.
 * - A cross-tab `logout` broadcast signs this tab out too.
 *
 * The app root is hidden synchronously the moment a sign-out is decided so
 * the async sign-out round-trip never flashes content on screen. Never
 * active on `/login` or while unauthenticated.
 */
export function useAutoLogout(): void {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const [enabled] = usePrefSync(
		prefKeys.privacyAutoLogoutEnabled,
		false,
		booleanCodec(),
	)
	const [delayMs] = usePrefSync(
		prefKeys.privacyAutoLogoutDelayMs,
		DEFAULT_AUTO_LOGOUT_DELAY_MS,
		numberCodec(),
	)
	const inFlightRef = useRef(false)

	useEffect(
		function watchVisibility() {
			let hiddenAt = 0
			let hiddenTimer: number | undefined

			function isAuthenticated(): boolean {
				const status = queryClient.getQueryData<AuthStatus>(authStatusQueryKey)
				return status?.authenticated === true
			}

			async function signOutLocal(): Promise<void> {
				if (inFlightRef.current) return
				inFlightRef.current = true
				try {
					// Hide the app synchronously so the async sign-out
					// round-trip cannot flash content to a bystander.
					hideAppRoot()
					await performSignOut(queryClient)
					await navigate({ to: "/login" })
				} finally {
					showAppRoot()
					inFlightRef.current = false
				}
			}

			function handleHidden(): void {
				if (!enabled || !isAuthenticated()) return
				hiddenAt = Date.now()
				if (hiddenTimer !== undefined) clearTimeout(hiddenTimer)
				hiddenTimer = window.setTimeout(() => {
					void signOutLocal()
				}, delayMs)
			}

			async function handleVisible(): Promise<void> {
				if (hiddenTimer !== undefined) {
					clearTimeout(hiddenTimer)
					hiddenTimer = undefined
				}
				const elapsed = hiddenAt === 0 ? 0 : Date.now() - hiddenAt
				hiddenAt = 0
				if (!isAuthenticated()) return
				if (enabled && elapsed >= delayMs) {
					await signOutLocal()
					return
				}
				try {
					const status = await queryClient.fetchQuery({
						...authStatusQueryOptions(),
						staleTime: 0,
					})
					if (!status.authenticated) {
						await navigate({ to: "/login" })
					}
				} catch {
					// Transient network failure: leave the current state alone.
				}
			}

			function handleVisibilityChange(): void {
				if (document.visibilityState === "hidden") {
					handleHidden()
				} else {
					void handleVisible()
				}
			}

			// bfcache restores the page without a `visibilitychange` on some
			// platforms; `pageshow` is the reliable signal. Timers froze while
			// the page was frozen, so `hiddenAt` + `Date.now()` still span the
			// full absence and the delay check stays correct.
			function handlePageShow(event: PageTransitionEvent): void {
				if (event.persisted) {
					void handleVisible()
				}
			}

			const unsubscribeBroadcast = subscribeAuthLogout(() => {
				if (!isAuthenticated()) return
				const previous =
					queryClient.getQueryData<AuthStatus>(authStatusQueryKey)
				queryClient.clear()
				queryClient.setQueryData(authStatusQueryKey, {
					authenticated: false,
					configured: previous?.configured ?? true,
				})
				void navigate({ to: "/login" })
			})

			document.addEventListener("visibilitychange", handleVisibilityChange)
			window.addEventListener("pageshow", handlePageShow)
			return () => {
				document.removeEventListener("visibilitychange", handleVisibilityChange)
				window.removeEventListener("pageshow", handlePageShow)
				unsubscribeBroadcast()
				if (hiddenTimer !== undefined) clearTimeout(hiddenTimer)
			}
		},
		[enabled, delayMs, queryClient, navigate],
	)
}

function hideAppRoot(): void {
	const root = document.getElementById("root")
	if (root !== null) root.style.visibility = "hidden"
}

function showAppRoot(): void {
	const root = document.getElementById("root")
	if (root !== null) root.style.visibility = ""
}
