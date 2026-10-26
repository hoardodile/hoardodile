import type { AuthStatus } from "@hoardodile/schemas"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { authStatusQueryKey, authStatusQueryOptions } from "@/features/auth"
import {
	canAccessContent,
	clearSession,
	isSessionLocked,
	lockSession,
	needsUnlock,
	sessionGeneration,
	sessionMode,
	useWebAuthPreference,
	webAuthKeys,
} from "@/features/auth/session"
import { stopActiveMediaPreview } from "@/features/res/components/mediaPlayback"
import { isHoardodileDesktop } from "@/lib/desktop"
import { subscribeAuthLogout } from "./privacySignOut"

/** Lock only this page; actual sign-out remains an explicit account action. */
export function useSessionProtection(): void {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const [autoLock] = useWebAuthPreference(webAuthKeys.autoLock)
	const busy = useRef(false)
	const protectedGeneration = useRef<number | undefined>(undefined)
	useEffect(() => {
		async function lock(): Promise<void> {
			if (busy.current || !needsUnlock()) return
			busy.current = true
			lockSession(
				window.location.pathname +
					window.location.search +
					window.location.hash,
			)
			try {
				const generation = sessionGeneration()
				if (protectedGeneration.current !== generation) {
					stopActiveMediaPreview()
					await queryClient.cancelQueries()
					if (!isSessionLocked() || sessionGeneration() !== generation) return
					queryClient.clear()
					queryClient.setQueryData(authStatusQueryKey, {
						authenticated: false,
						configured: true,
					} satisfies AuthStatus)
					protectedGeneration.current = generation
				}
				await navigate({ to: "/unlock", replace: true })
			} finally {
				busy.current = false
			}
		}
		async function validate(): Promise<void> {
			if (isSessionLocked()) {
				await lock()
				return
			}
			if (!canAccessContent()) return
			try {
				const status = await queryClient.fetchQuery({
					...authStatusQueryOptions(),
					staleTime: 0,
				})
				if (!status.authenticated) {
					if (status.configured && needsUnlock()) await lock()
					else await navigate({ to: "/login", replace: true })
				}
			} catch {
				/* A transient network failure must not authorize a locked page. */
			}
		}
		function visibility(): void {
			if (document.visibilityState === "hidden") {
				if (!isHoardodileDesktop() && autoLock && canAccessContent())
					void lock()
			} else {
				void validate()
			}
		}
		function pageShow(event: PageTransitionEvent): void {
			if (event.persisted) void validate()
		}
		function sessionLocked(): void {
			void lock()
		}
		const unsubscribe = subscribeAuthLogout(() => {
			if (sessionMode() === "page") return
			clearSession()
			queryClient.clear()
			queryClient.setQueryData(authStatusQueryKey, {
				authenticated: false,
				configured: true,
			})
			void navigate({ to: "/login", replace: true })
		})
		document.addEventListener("visibilitychange", visibility)
		window.addEventListener("pageshow", pageShow)
		window.addEventListener("hoardodile-session-locked", sessionLocked)
		return () => {
			document.removeEventListener("visibilitychange", visibility)
			window.removeEventListener("pageshow", pageShow)
			window.removeEventListener("hoardodile-session-locked", sessionLocked)
			unsubscribe()
		}
	}, [autoLock, queryClient, navigate])
}
