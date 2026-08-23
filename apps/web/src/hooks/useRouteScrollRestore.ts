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

/** Frames the restored position must hold before the restore is done (~50ms). */
const LANDED_CONFIRM_FRAMES = 3

/**
 * Frames with an unchanged height before a page shorter than the target is
 * accepted (~1.5s). The old heuristic stopped after a single stable frame,
 * but skeletons hold a constant height while their data is still in flight
 * and then grow way past the stored position.
 */
const SHORT_PAGE_SETTLE_FRAMES = 90

/** Absolute cap so a never-settling page cannot re-align forever (~5s). */
const RESTORE_HARD_CAP_FRAMES = 300

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
		 *
		 * The loop accepts the target only after it holds for a few
		 * consecutive frames (skeletons stay at one height for hundreds of
		 * ms while their data is still loading, so a single stable frame is
		 * not enough), and calls a genuinely short page done only after
		 * ~1.5s of an unchanged height.
		 */
		function restore(key: string) {
			const top = readRouteScroll(key) ?? 0
			const container = getAppScrollContainer()
			restoring = true
			let attempts = 0
			let frame = 0
			let landedFrames = 0
			let settledFrames = 0
			let lastMaxScroll = -1
			let lastAppliedTop = -1

			/** How far down the container can currently scroll. */
			function maxScrollOf() {
				if (container instanceof HTMLElement) {
					return Math.max(container.scrollHeight - container.clientHeight, 0)
				}
				return Math.max(
					document.documentElement.scrollHeight - container.innerHeight,
					0,
				)
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
				const maxScroll = maxScrollOf()
				const target = Math.min(top, maxScroll)
				lastAppliedTop = target
				container.scrollTo({ top: target, behavior: "instant" })
				const applied = scrollTopOf(container)

				// Count frames where the full target is reachable and holds.
				// The clamped short-page case never counts, so a skeleton
				// shorter than the stored position keeps the loop alive until
				// the content settles (or the user scrolls away).
				if (maxScroll >= top && applied >= top - 1) {
					landedFrames += 1
				} else {
					landedFrames = 0
				}

				if (maxScroll !== lastMaxScroll) {
					lastMaxScroll = maxScroll
					settledFrames = 0
				} else {
					settledFrames += 1
				}

				const done =
					landedFrames >= LANDED_CONFIRM_FRAMES ||
					(top > 0 && settledFrames >= SHORT_PAGE_SETTLE_FRAMES) ||
					attempts >= RESTORE_HARD_CAP_FRAMES
				if (!done) {
					frame = requestAnimationFrame(tick)
				} else {
					container.removeEventListener("scroll", abort)
					restoring = false
				}
			}

			if (top === 0) {
				// Nothing to restore: one-shot reset, no re-align loop.
				container.scrollTo({ top: 0, behavior: "instant" })
				restoring = false
				return () => {}
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
			// Clear the cached route so a StrictMode remount (dev) re-applies
			// and restores instead of skipping the restore as a no-op.
			stateRef.current = undefined
		}
	}, [router])
}
