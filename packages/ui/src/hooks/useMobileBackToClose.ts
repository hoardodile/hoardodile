import { isBelowMd } from "@hoardodile/ui/hooks/use-mobile"
import { useEffect, useRef } from "react"

const HISTORY_KEY = "__appMobileOverlay"

/**
 * LIFO stack of currently-open overlays registered via
 * {@link useMobileBackToClose}. Each entry knows how to close its own
 * overlay. The browser back gesture only closes the top entry, so
 * stacking dialogs/popovers/sheets unwind in reverse opening order
 * instead of all collapsing on the first back press.
 *
 * State is module-level so multiple component instances share a
 * single popstate listener and a single ordering source of truth.
 */
type OverlayEntry = {
	readonly id: number
	/** Original history state captured at push time for later restore. */
	readonly baseState: unknown
	close: (() => void) | undefined
}

const overlayStack: OverlayEntry[] = []
let popListenerInstalled = false
let historyPatched = false
let nextOverlayId = 0
// Counts consecutive popstate events to suppress. When we call
// `history.back()` N times (e.g. to unwind an active entry plus
// parked entries), the next N popstate events must be swallowed so
// they don't cascade-close deeper overlays.
let suppressPopCount = 0
/**
 * Tracks every synthetic entry ID ever pushed. Used by the
 * capture-phase popstate listener to identify "phantom" entries —
 * synthetic history slots that remain in forward/back history after
 * the overlay was closed via route navigation. The listener auto-skips
 * these to prevent dead back-presses and router confusion.
 */
const seenSyntheticIds = new Set<number>()

/**
 * Optional navigation-resolver registration injected by the host app.
 *
 * When set (via {@link setNavigationResolver}), `scheduleStateRestore`
 * uses it to receive a deterministic "navigation complete" signal from
 * the router instead of guessing timing via `requestAnimationFrame`.
 *
 * The registered function accepts a one-shot callback and returns an
 * unsubscribe function. The hook calls it, inspects `history.state`
 * inside the callback, then unsubscribes.
 */
type NavigationResolver = (onResolved: () => void) => () => void
let navigationResolver: NavigationResolver | undefined

/**
 * Registers a navigation-resolver factory so that
 * {@link useMobileBackToClose} can wait for the router to finish
 * flushing its history mutations before inspecting `history.state`.
 *
 * Call this once at app startup, after the router is created:
 *
 * ```ts
 * import { setNavigationResolver } from "@hoardodile/ui"
 * import { router } from "./router"
 *
 * setNavigationResolver((fn) => router.subscribe("onResolved", fn))
 * ```
 *
 * When no resolver is registered, the hook falls back to
 * `requestAnimationFrame` (correct for microtask-based routers but
 * less deterministic).
 */
export function setNavigationResolver(resolver: NavigationResolver): void {
	navigationResolver = resolver
}

/**
 * Patches `history.pushState` once (idempotent) so that every call
 * from a router (or any other non-overlay code) is intercepted.
 *
 * When a pushState is detected that does NOT carry our
 * {@link HISTORY_KEY} marker, all open overlay entries are closed
 * and the stack is cleared. The synthetic entry's marker is
 * intentionally NOT stripped — the capture-phase popstate listener
 * uses it to identify and auto-skip the stranded entry when the
 * user later navigates past it.
 */
function patchHistory(): void {
	if (historyPatched) return
	if (typeof window === "undefined") return
	historyPatched = true
	const origPush = window.history.pushState.bind(window.history)
	window.history.pushState = (
		data: unknown,
		unused: string,
		url?: string | URL | null,
	): void => {
		const state = data as Record<string, unknown> | null
		if (state !== null && typeof state === "object" && HISTORY_KEY in state) {
			// Our own synthetic push — pass through.
			origPush(data, unused, url)
			return
		}
		// Real navigation — close all overlays so the stack is
		// cleared synchronously (before React's async effects).
		// The synthetic entry remains in history with its marker
		// intact; the capture-phase popstate listener will
		// auto-skip it later.
		if (overlayStack.length > 0) {
			closeAllOverlays()
		}
		origPush(data, unused, url)
	}
}

/**
 * Closes every active overlay in the stack (top-down) and clears
 * the stack. Called when a real navigation is detected so that
 * overlay state doesn't leak across route boundaries.
 */
function closeAllOverlays(): void {
	while (overlayStack.length > 0) {
		const entry = overlayStack.pop()
		if (entry?.close !== undefined) {
			const fn = entry.close
			entry.close = undefined
			fn()
		}
	}
}

/**
 * Installs popstate listeners and patches history.pushState.
 *
 * Two listeners are installed:
 *
 * 1. **Capture-phase** — runs BEFORE any bubbling-phase listeners
 *    (including TanStack Router's popstate handler). Inspects the
 *    state at the history pointer:
 *
 *    - **Active entry** (id found in overlayStack): the back
 *      gesture landed on a synthetic entry that belongs to an
 *      overlay still below the top of the stack. Pop and close the
 *      top overlay (the one the user is actually dismissing) and
 *      block the event from reaching the router via
 *      `stopImmediatePropagation()`.
 *
 *    - **Phantom entry** (id in `seenSyntheticIds` but NOT in
 *      overlayStack): a synthetic history slot that remains after
 *      the overlay was closed via route navigation. Blocks the
 *      event AND auto-skips by calling `history.back()` to advance
 *      the pointer past the phantom, so the router never sees its
 *      stale URL.
 *
 * 2. **Bubbling-phase** — closes the top overlay when the back
 *    gesture returns to the base route state (no synthetic marker),
 *    which happens for the last open overlay.
 */
function ensurePopListener(): void {
	if (popListenerInstalled) return
	if (typeof window === "undefined") return
	popListenerInstalled = true

	// Capture-phase gate: block synthetic popstate from reaching
	// the router (or any other bubbling-phase listener on window).
	window.addEventListener(
		"popstate",
		(e: PopStateEvent) => {
			if (suppressPopCount > 0) return // let the counter handle it
			const state = e.state as Record<string, unknown> | null
			if (state !== null && typeof state === "object" && HISTORY_KEY in state) {
				const id = state[HISTORY_KEY]
				// Active entry still in the stack → the back gesture
				// landed on a synthetic entry of an overlay below the
				// top. Close the top overlay and hide the event from
				// the router.
				if (
					typeof id === "number" &&
					overlayStack.some((entry) => entry.id === id)
				) {
					closeTopOverlay()
					e.stopImmediatePropagation()
					return
				}
				// Phantom entry: a synthetic history slot that
				// remains after the overlay was closed via
				// route navigation. Block the event from the
				// router AND auto-skip by calling history.back()
				// to move the pointer past the phantom.
				e.stopImmediatePropagation()
				if (typeof id === "number" && seenSyntheticIds.has(id)) {
					window.history.back()
				}
			}
		},
		true, // capture phase
	)

	window.addEventListener("popstate", handlePop)
	patchHistory()
}

function closeTopOverlay(): void {
	const top = overlayStack.pop()
	if (top === undefined) return
	// `close` may be cleared if this entry was dismissed via UI from a
	// non-top position; the popstate then just unwinds a stale
	// synthetic history slot and there is nothing to close.
	if (top.close === undefined) return
	// Clear close before calling it so the resulting effect sees
	// idRef as undefined (back-gesture close) and skips the
	// back() + replaceState() UI-close path.
	const closeFn = top.close
	top.close = undefined
	closeFn()
}

function handlePop(): void {
	if (suppressPopCount > 0) {
		suppressPopCount--
		return
	}
	closeTopOverlay()
}

/**
 * Removes the entry with the given `id` from the overlay stack.
 *
 * When the entry is **not** the top of the stack, it is "parked"
 * (left in place with its close callback cleared) so the synthetic
 * history slot survives until swept.
 *
 * @returns An object describing what was removed:
 *   - `removed`: whether the entry was found.
 *   - `parkedBelow`: how many parked (close=undefined) entries were
 *     found below the removed entry. These must be unwound alongside
 *     the active entry to prevent dead back-presses.
 */
function removeFromStack(id: number): {
	readonly removed: boolean
	readonly parkedBelow: number
} {
	const idx = overlayStack.findIndex((e) => e.id === id)
	if (idx === -1) return { removed: false, parkedBelow: 0 }
	const wasTop = idx === overlayStack.length - 1
	if (!wasTop) {
		// Park: keep the history slot but neutralise the callback.
		const entry = overlayStack[idx]
		if (entry !== undefined) entry.close = undefined
		return { removed: true, parkedBelow: 0 }
	}
	// Top entry — remove it and count ALL parked entries below so
	// their orphaned synthetic history slots are unwound in the same
	// batch as the active entry's slot.
	overlayStack.pop()
	const remaining = overlayStack.splice(0, overlayStack.length)
	const active = remaining.filter((e) => e.close !== undefined)
	const parkedBelow = remaining.length - active.length
	overlayStack.push(...active)
	return { removed: true, parkedBelow }
}

/**
 * Cleans up the synthetic history entry after an overlay closes via
 * UI (not back gesture, not route navigation).
 *
 * `history.back()` is asynchronous — it queues a history traversal
 * task. The popstate event fires only after the traversal completes
 * (pointer has moved to the target entry). By replacing the state
 * inside the popstate handler, we ensure:
 *
 * 1. The pointer is at the base entry (not the synthetic one).
 * 2. `replaceState` truncates forward history, eliminating the
 *    phantom synthetic entry that `back()` alone would leave behind.
 *
 * **Route-change safety**: When a navigation-resolver is registered
 * (via {@link setNavigationResolver}), `scheduleStateRestore` uses
 * the router's deterministic "navigation resolved" signal to know
 * when `history.state` reflects the new route. When no resolver is
 * available (e.g. tests), it falls back to `requestAnimationFrame`,
 * which runs after the microtask queue where the router flushes its
 * pending `pushState` calls.
 *
 * - If `history.state` still carries our marker → normal UI close,
 *   proceed with the `back()` + `replaceState()` cleanup.
 * - If `history.state` no longer carries our marker → a route
 *   change has pushed a real entry on top. Skip the `back()` call
 *   to avoid racing with the router's push. The capture-phase
 *   popstate listener will auto-skip the stranded phantom entry.
 */
function scheduleStateRestore(
	id: number,
	baseState: unknown,
	parkedBelow: number,
): void {
	function check(): void {
		const currentState = window.history.state as Record<string, unknown> | null

		// The history pointer is no longer on this overlay's own
		// synthetic entry (route change, or another overlay has
		// already pushed/popped on top). Do NOT call history.back()
		// — it would race with the current top entry and navigate
		// to the wrong place. Just sweep parked entries from the
		// stack but do NOT prune `seenSyntheticIds`; any stranded
		// synthetic entries will be auto-skipped by the capture-phase
		// listener when the user navigates past them.
		if (
			currentState === null ||
			typeof currentState !== "object" ||
			!(HISTORY_KEY in currentState) ||
			currentState[HISTORY_KEY] !== id
		) {
			sweepParkedEntries()
			return
		}

		const totalBacks = 1 + parkedBelow
		let done = false

		function restore(): void {
			if (done) return
			done = true
			window.removeEventListener("popstate", onPop)
			window.history.replaceState(baseState, "")
			// replaceState truncates forward history, eliminating
			// phantom entries. Safe to prune their IDs from
			// `seenSyntheticIds` (excluding IDs still in the
			// active stack).
			const sweptIds = sweepParkedEntries()
			cleanupSeenIds(sweptIds)
		}

		function onPop(): void {
			if (suppressPopCount > 0) {
				suppressPopCount--
				return
			}
			restore()
		}

		window.addEventListener("popstate", onPop)

		suppressPopCount += totalBacks
		for (let i = 0; i < totalBacks; i++) {
			window.history.back()
		}
	}

	// Use both the router's deterministic "navigation resolved" signal
	// and a requestAnimationFrame fallback. In the common UI-close case
	// (e.g. clicking outside a dropdown) there is no route change, so
	// the resolver never fires. Without the fallback the synthetic
	// history entry would be left behind as a phantom.
	let disposed = false
	let rafId: number | undefined
	let unsub: (() => void) | undefined

	function run(): void {
		if (disposed) return
		disposed = true
		unsub?.()
		if (rafId !== undefined) {
			cancelAnimationFrame(rafId)
		}
		check()
	}

	if (navigationResolver !== undefined) {
		unsub = navigationResolver(run)
	}

	rafId = requestAnimationFrame(run)
}

/**
 * Sweeps all parked entries (those with no close callback) from the
 * overlay stack. Called after `replaceState` truncates forward
 * history, since parked entries no longer have corresponding history
 * entries and would cause dead back-presses.
 *
 * @returns The IDs of entries that were removed, used by the caller
 *   to prune `seenSyntheticIds`.
 */
function sweepParkedEntries(): readonly number[] {
	const sweptIds: number[] = []
	for (let i = overlayStack.length - 1; i >= 0; i--) {
		const entry = overlayStack[i]
		if (entry !== undefined && entry.close === undefined) {
			sweptIds.push(entry.id)
			overlayStack.splice(i, 1)
		}
	}
	return sweptIds
}

/**
 * Removes swept IDs from `seenSyntheticIds` to prevent unbounded
 * growth over the lifetime of the SPA session.
 *
 * After `replaceState` truncates forward history, phantom entries
 * for swept parked overlays are eliminated. Their IDs can safely
 * be removed from `seenSyntheticIds` — unless the same ID belongs
 * to an entry still active in the stack (which happens when a
 * lower-ID entry is parked but a higher-ID entry above it is still
 * open and not swept).
 */
function cleanupSeenIds(sweptIds: readonly number[]): void {
	const activeIds = new Set(overlayStack.map((e) => e.id))
	for (const id of sweptIds) {
		if (!activeIds.has(id)) {
			seenSyntheticIds.delete(id)
		}
	}
}

/**
 * On mobile (< sm), when an overlay (dialog/sheet/popover) opens we push a
 * synthetic history entry so the device back gesture closes it instead of
 * navigating away from the page.
 *
 * **Closing via UI** calls `history.back()` to navigate past the
 * synthetic entry, then uses `replaceState` (inside the resulting
 * popstate handler) to restore the original history state.
 *
 * **Closing via back gesture** is handled by the popstate listener,
 * which pops the stack entry and calls the close callback.
 *
 * **Closing via route navigation**: the `pushState` interceptor
 * closes all overlays synchronously but does NOT strip the synthetic
 * marker. The React effect's `scheduleStateRestore` waits for the
 * router's navigation-resolved signal (or falls back to
 * `requestAnimationFrame`); by then the router's push has completed
 * and the marker is gone from `history.state`, so `back()` is
 * skipped. The stranded synthetic entry is later auto-skipped by the
 * capture-phase popstate listener when the user navigates past it.
 *
 * Multiple overlays open at once stack: pressing back closes the most
 * recently opened one first, matching the visual stacking order.
 *
 * No-op on non-mobile viewports and when no `onOpenChange` is provided
 * (uncontrolled overlays cannot be closed externally).
 */
export function useMobileBackToClose(
	open: boolean | undefined,
	onOpenChange: ((open: boolean) => void) | undefined,
): void {
	const idRef = useRef<number | undefined>(undefined)
	const onChangeRef = useRef(onOpenChange)
	onChangeRef.current = onOpenChange

	useEffect(() => {
		if (typeof window === "undefined") return
		if (onChangeRef.current === undefined) return
		if (!isBelowMd()) return
		ensurePopListener()

		if (open === true && idRef.current === undefined) {
			const id = ++nextOverlayId
			idRef.current = id
			seenSyntheticIds.add(id)
			// Capture the base state BEFORE pushing so we can restore
			// it on close (via replaceState) to eliminate phantoms.
			const baseState = window.history.state ?? null
			window.history.pushState(
				{
					...((baseState as Record<string, unknown>) ?? {}),
					[HISTORY_KEY]: id,
				},
				"",
			)
			overlayStack.push({
				id,
				baseState,
				close() {
					idRef.current = undefined
					onChangeRef.current?.(false)
				},
			})
			return
		}

		if (open !== true && idRef.current !== undefined) {
			const id = idRef.current
			idRef.current = undefined
			const entryIdx = overlayStack.findIndex((e) => e.id === id)
			const entry = entryIdx !== -1 ? overlayStack[entryIdx] : undefined
			const { removed, parkedBelow } = removeFromStack(id)
			if (removed && entry !== undefined) {
				scheduleStateRestore(id, entry.baseState, parkedBelow)
			}
		}
	}, [open])

	useEffect(() => {
		return () => {
			if (idRef.current !== undefined) {
				const id = idRef.current
				idRef.current = undefined
				const entryIdx = overlayStack.findIndex((e) => e.id === id)
				const entry = entryIdx !== -1 ? overlayStack[entryIdx] : undefined
				const { removed, parkedBelow } = removeFromStack(id)
				if (removed && entry !== undefined) {
					scheduleStateRestore(id, entry.baseState, parkedBelow)
				}
			}
		}
	}, [])
}
