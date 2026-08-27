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

/**
 * Frames the restored position must hold alongside an unchanged height
 * before the restore is done (~500ms). A skeleton that keeps its height
 * for a couple of frames is not enough: list and image content usually
 * keeps growing for hundreds of ms, and stopping early leaves the user
 * stuck above the stored position.
 */
const LANDED_STABLE_FRAMES = 30

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
 * sessionStorage keyed by `pathname + search`.
 *
 * Restoration is directional only: a browser back navigation (history
 * index decreases) returns to the stored position; every other transition
 * to a different route — push, forward, replace — resets the container to
 * the top instead of reviving an old scroll position. The initial load is
 * treated like back so a refresh or a desktop reopen lands where the user
 * left off (the `pagehide` flush covers the leave).
 *
 * The position of the outgoing route is flushed from `onBeforeLoad`, i.e.
 * before any pending skeleton replaces the content and the browser clamps
 * the container's `scrollTop` to the skeleton height — the old
 * `onResolved`-time flush read that clamped value and wrote it back, which
 * made back-restores drift. While a navigation is in flight (`leaving`)
 * and while a restore settles (`restoring`) no position is written.
 */
export function useRouteScrollRestore() {
	const router = useRouter()
	const stateRef = useRef<
		| {
				readonly key: string
				readonly tracked: boolean
				readonly index: number
		  }
		| undefined
	>(undefined)

	useEffect(() => {
		let scrollHandler: (() => void) | undefined
		let detachScroll: (() => void) | undefined
		let cancelRestore: (() => void) | undefined
		// True while a restore is settling: the container is being moved
		// programmatically, so interim positions must not be written back
		// (neither by the throttled writer nor the leave/pagehide flushes).
		let restoring = false
		// True between navigation start (`onBeforeLoad`) and resolution
		// (`onResolved`): the outgoing page may already be unmounted and the
		// container clamped, so the throttled writer must stay silent.
		let leaving = false
		// The position of the most recent one-shot programmatic reset plus the
		// number of resets whose async scroll event has not been seen yet.
		// Programmatic scrolls fire exactly one async scroll event each — but
		// with a throttled writer that event can arrive AFTER a later reset,
		// so a single "pending" flag is not enough (the late event would
		// consume the newer reset's slot and a leave flush of the freshly
		// reset page would then overwrite the route's stored position with
		// 0). The throttled writer consumes one slot per matching event; the
		// leave/pagehide flushes only skip while a slot is open and never
		// consume — a real user move (a position we never asked for) clears
		// everything.
		let programmaticTop = -1
		let programmaticResets = 0
		const MAX_PROGRAMMATIC_RESETS = 4

		/** True when `top` is where our own reset left the container. */
		function matchesProgrammaticReset(top: number): boolean {
			if (programmaticTop < 0 || programmaticResets <= 0) return false
			// A position we never asked for is a real (user) scroll: the
			// guard ends and the value records normally.
			if (Math.abs(top - programmaticTop) > 1) {
				programmaticTop = -1
				programmaticResets = 0
				return false
			}
			return true
		}

		function currentState() {
			const { location, matches } = router.state
			const key = routeScrollKey(location.pathname, location.searchStr)
			const deepest = matches[matches.length - 1]
			const rawIndex = (
				location.state as { readonly __TSR_index?: number } | undefined
			)?.__TSR_index
			return {
				key,
				tracked: isRouteScrollTracked(deepest?.routeId ?? ""),
				index: typeof rawIndex === "number" ? rawIndex : 0,
			} as const
		}

		function attach() {
			if (scrollHandler !== undefined) return
			const throttled = throttle(() => {
				const state = stateRef.current
				if (state?.tracked !== true || restoring || leaving) return
				const top = scrollTopOf(getAppScrollContainer())
				// Our own resets fire async scroll events; recording their
				// position would poison the route's stored value for the next
				// back-restore. One slot per pending reset, consumed by its
				// (possibly late) event.
				if (matchesProgrammaticReset(top)) {
					programmaticResets = Math.max(0, programmaticResets - 1)
					return
				}
				writeRouteScroll(state.key, top)
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
		 * consecutive frames with an unchanged height (skeletons stay at one
		 * height for hundreds of ms while their data is still loading, so a
		 * single stable frame is not enough), and calls a genuinely short
		 * page done only after ~1.5s of an unchanged height.
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
			// The position the last scrollTo actually reached (post-clamp).
			// The abort guard compares against this instead of the requested
			// target: the browser rejects a scrollTo past the current max
			// (short skeleton) and clamps scrollTop down, which is our own
			// movement — only a position we did not ask for is a user scroll.
			let lastApplied = -1

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

			// A manual scroll during the settle window wins: stop re-applying.
			function abort() {
				if (
					lastApplied >= 0 &&
					Math.abs(scrollTopOf(container) - lastApplied) > 2
				) {
					cancelFrame()
				}
			}

			function tick() {
				frame = 0
				attempts += 1
				const maxScroll = maxScrollOf()
				const target = Math.min(top, maxScroll)
				container.scrollTo({ top: target, behavior: "instant" })
				lastApplied = scrollTopOf(container)

				// Count frames where the full target is reachable and holds.
				// The clamped short-page case never counts, so a skeleton
				// shorter than the stored position keeps the loop alive until
				// the content settles (or the user scrolls away).
				if (maxScroll >= top && lastApplied >= top - 1) {
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
					landedFrames >= LANDED_STABLE_FRAMES ||
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

		/** One-shot reset for forward / push / replace transitions. */
		function resetToTop() {
			programmaticTop = 0
			programmaticResets = Math.min(
				MAX_PROGRAMMATIC_RESETS,
				programmaticResets + 1,
			)
			getAppScrollContainer().scrollTo({ top: 0, behavior: "instant" })
		}

		function apply() {
			const next = currentState()
			const prev = stateRef.current
			stateRef.current = next
			leaving = false
			if (!next.tracked) {
				detach()
				return
			}
			attach()
			if (prev === undefined) {
				// First mount / refresh: restore the stored position (or the
				// top when the route was never recorded).
				cancelRestore?.()
				cancelRestore = restore(next.key)
				return
			}
			if (prev.key === next.key) {
				// The same route again: a back to an earlier history entry
				// restores (two fast back/forward pops can skip the
				// intermediate resolution, still ending at the same route);
				// a push to the page you are on already keeps the position.
				if (next.index >= prev.index) return
				cancelRestore?.()
				cancelRestore = restore(next.key)
				return
			}
			cancelRestore?.()
			if (next.index < prev.index) {
				// Browser back: return to where the user left this route.
				cancelRestore = restore(next.key)
			} else {
				// Push, browser forward or a same-index replace to a new key:
				// a fresh page starts at the top.
				resetToTop()
			}
		}

		function onBeforeLoad(event: {
			readonly fromLocation?: {
				readonly pathname: string
				readonly searchStr: string
			}
		}) {
			const state = stateRef.current
			if (
				state?.tracked === true &&
				!restoring &&
				event.fromLocation !== undefined &&
				state.key ===
					routeScrollKey(
						event.fromLocation.pathname,
						event.fromLocation.searchStr,
					)
			) {
				// The outgoing page is still mounted: flush the exact position
				// before any pending skeleton clamps the container. Skipped
				// when the outgoing page sits where our own reset left it —
				// the reset must not become the route's stored position.
				const top = scrollTopOf(getAppScrollContainer())
				if (!matchesProgrammaticReset(top)) {
					writeRouteScroll(state.key, top)
				}
			}
			leaving = true
		}

		function flushOnPageHide() {
			const state = stateRef.current
			if (state?.tracked === true && !restoring && !leaving) {
				const top = scrollTopOf(getAppScrollContainer())
				if (!matchesProgrammaticReset(top)) {
					writeRouteScroll(state.key, top)
				}
			}
		}

		apply()
		const unsubscribe = router.subscribe("onResolved", apply)
		const unsubscribeBeforeLoad = router.subscribe("onBeforeLoad", onBeforeLoad)
		window.addEventListener("pagehide", flushOnPageHide)
		return () => {
			unsubscribe()
			unsubscribeBeforeLoad()
			window.removeEventListener("pagehide", flushOnPageHide)
			cancelRestore?.()
			detach()
			// Clear the cached route so a StrictMode remount (dev) re-applies
			// and restores instead of skipping the restore as a no-op.
			stateRef.current = undefined
		}
	}, [router])
}
