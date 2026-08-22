import { useEffect, useSyncExternalStore } from "react"

let currentSlot: HTMLElement | null = null
let claimCount = 0
const listeners = new Set<() => void>()

function notify() {
	for (const listener of listeners) listener()
}

/**
 * Callback-ref target for the filter rail's `data-panel-slot` container.
 * The AppShell guarantees at most one registered slot at a time (the
 * desktop column registers at the panel breakpoint, the drawer instance
 * below it), so the latest registration is always the visible one.
 */
export function registerPanelSlot(el: HTMLElement | null) {
	if (el === currentSlot) return
	currentSlot = el
	notify()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function getSnapshot() {
	return currentSlot
}

function getServerSnapshot(): HTMLElement | null {
	return null
}

function getClaimedSnapshot() {
	return claimCount > 0
}

function getClaimedServerSnapshot() {
	return false
}

/**
 * Returns the currently visible filter-rail slot (the `data-panel-slot`
 * container rendered by the AppShell), or null when none is mounted —
 * e.g. below the panel breakpoint before the drawer has been opened.
 *
 * Portal usage from a route component (mounts after the shell, so the
 * first render may see null and re-render once the slot registers):
 *
 * ```tsx
 * const slot = usePanelSlot()
 * return slot === null ? null : createPortal(<FilterRail />, slot)
 * ```
 *
 * The AppShell only renders its panel containers while a caller claims
 * the slot via {@link useClaimPanelSlot}.
 */
export function usePanelSlot(): HTMLElement | null {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Claims the right filter-rail slot while the caller is mounted: the
 * AppShell renders its panel containers (desktop column + drawer) only
 * while at least one claim is active.
 */
export function useClaimPanelSlot(): HTMLElement | null {
	const slot = usePanelSlot()
	useEffect(() => {
		claimCount += 1
		notify()
		return () => {
			claimCount -= 1
			notify()
		}
	}, [])
	return slot
}

/** Internal to the AppShell: whether a route module claimed the slot. */
export function usePanelSlotClaimed(): boolean {
	return useSyncExternalStore(
		subscribe,
		getClaimedSnapshot,
		getClaimedServerSnapshot,
	)
}
