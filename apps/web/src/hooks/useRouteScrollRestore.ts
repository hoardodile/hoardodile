import { useRouter } from "@tanstack/react-router"
import { throttle } from "es-toolkit"
import { useEffect, useRef } from "react"
import {
	getAppScrollContainer,
	scrollTopOf,
} from "@/features/doc/lib/docReadingAnchor"
import {
	isRouteScrollTracked,
	readRouteScroll,
	routeScrollKey,
	writeRouteScroll,
} from "@/lib/routeScrollRestore"

const WRITE_INTERVAL_MS = 250

/** Frames to keep re-aligning the restored position (~270ms total). */
const RESTORE_MAX_FRAMES = 16

/**
 * Persist and restore the app scroll container's position per route.
 *
 * Mount once (AppShell). Tracks every route except those that manage
 * their own position (document reader, plugin readers): while a tracked
 * route is active, the container's `scrollTop` is throttled into
 * sessionStorage keyed by `pathname + search`; on entry the stored value
 * is restored, or the container is reset to the top when the route has no
 * stored position. Refreshes are covered by a `pagehide` flush, so
 * forward/back navigation after a reload still lands where the user left
 * off.
 */
export function useRouteScrollRestore() {
	const router = useRouter()
	const stateRef = useRef<
		{ readonly key: string; readonly tracked: boolean } | undefined
	>(undefined)

	useEffect(() => {
		let scrollHandler: (() => void) | undefined
		let detachScroll: (() => void) | undefined
		let cancelRestore: (() => void) | undefined
		// True while a restore is settling: the container is being moved
		// programmatically, so interim positions must not be written back
		// (neither by the throttled writer nor the leave/pagehide flushes).
		let restoring = false

		function currentKeyAndTracked() {
			const { location, matches } = router.state
			const key = routeScrollKey(location.pathname, location.searchStr)
			const deepest = matches[matches.length - 1]
			return {
				key,
				tracked: isRouteScrollTracked(deepest?.routeId ?? ""),
			} as const
		}

		function attach() {
			if (scrollHandler !== undefined) return
			const throttled = throttle(() => {
				const state = stateRef.current
				if (state?.tracked !== true || restoring) return
				writeRouteScroll(state.key, scrollTopOf(getAppScrollContainer()))
			}, WRITE_INTERVAL_MS)
			scrollHandler = throttled
			const container = getAppScrollContainer()
			container.addEventListener("scroll", throttled, { passive: true })
			detachScroll = () => container.removeEventListener("scroll", throttled)
		}

		function detach() {
			detachScroll?.()
			detachScroll = undefined
			scrollHandler = undefined
		}
		/**
		 * Move the container to the stored top (or to 0 when nothing is
		 * stored — the previous route's position must not leak through).
		 * Route data lands via React Query after the route resolves, so a
		 * one-shot jump gets clamped to the pending skeleton's height; the
		 * target is re-applied every frame while the content is still
		 * growing, and stopped early when the user scrolls away.
		 */
		function restore(key: string) {
			const top = readRouteScroll(key) ?? 0
			const container = getAppScrollContainer()
			restoring = true
			let attempts = 0
			let frame = 0
			let lastAppliedTop = -1
			let lastMaxScroll = -1

			/** The container's current top and how far it can scroll. */
			function metrics() {
				if (container instanceof HTMLElement) {
					return {
						top: container.scrollTop,
						maxScroll: Math.max(
							container.scrollHeight - container.clientHeight,
							0,
						),
					}
				}
				return {
					top: container.scrollY,
					maxScroll: Math.max(
						document.documentElement.scrollHeight - container.innerHeight,
						0,
					),
				}
			}

			function cancelFrame() {
				if (frame !== 0) cancelAnimationFrame(frame)
				frame = 0
				container.removeEventListener("scroll", abort)
				restoring = false
			}

			// A manual scroll during the settle window wins: stop re-applying
			// (our own scrollTo is guarded by matching lastAppliedTop).
			function abort() {
				if (
					lastAppliedTop >= 0 &&
					Math.abs(scrollTopOf(container) - lastAppliedTop) > 2
				) {
					cancelFrame()
				}
			}

			function tick() {
				frame = 0
				attempts += 1
				const { top: scrollTop, maxScroll } = metrics()
				const target = Math.min(top, maxScroll)
				lastAppliedTop = target
				container.scrollTo({ top: target, behavior: "instant" })
				const heightSettled = maxScroll === lastMaxScroll
				lastMaxScroll = maxScroll
				// Done when the position landed, or the content settled
				// shorter than the target (nothing more to wait for).
				const landed =
					scrollTop >= top - 1 ||
					(top > 0 && heightSettled && scrollTop >= maxScroll - 1)
				if (attempts < RESTORE_MAX_FRAMES && !landed) {
					frame = requestAnimationFrame(tick)
				} else {
					container.removeEventListener("scroll", abort)
					restoring = false
				}
			}

			container.addEventListener("scroll", abort, { passive: true })
			frame = requestAnimationFrame(tick)
			return cancelFrame
		}
		function apply() {
			const next = currentKeyAndTracked()
			const prev = stateRef.current
			if (prev?.tracked && prev.key !== next.key && !restoring) {
				// Leaving a tracked page: the throttled writer may be one
				// tick behind, so flush the exact position. Skipped while a
				// restore is settling — the stored value is already the
				// intended one.
				writeRouteScroll(prev.key, scrollTopOf(getAppScrollContainer()))
			}
			stateRef.current = next
			if (next.tracked) {
				attach()
				if (prev === undefined || prev.key !== next.key) {
					cancelRestore?.()
					cancelRestore = restore(next.key)
				}
			} else {
				detach()
			}
		}

		function flushOnPageHide() {
			const state = stateRef.current
			if (state?.tracked === true && !restoring) {
				writeRouteScroll(state.key, scrollTopOf(getAppScrollContainer()))
			}
		}

		apply()
		const unsubscribe = router.subscribe("onResolved", apply)
		window.addEventListener("pagehide", flushOnPageHide)
		return () => {
			unsubscribe()
			window.removeEventListener("pagehide", flushOnPageHide)
			cancelRestore?.()
			detach()
		}
	}, [router])
}
