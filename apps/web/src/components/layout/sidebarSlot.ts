import { useEffect, useSyncExternalStore } from "react"

let currentSlot: HTMLElement | null = null
let claimCount = 0
const listeners = new Set<() => void>()

function notify() {
	for (const listener of listeners) listener()
}

/**
 * Callback-ref target for the sidebar's `data-sidebar-slot` container. The
 * AppShell guarantees at most one registered slot at a time (the desktop
 * sidebar registers at md+, the drawer instance below md), so the latest
 * registration is always the visible one.
 */
export function registerSidebarSlot(el: HTMLElement | null) {
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
 * Returns the currently visible sidebar module slot (the
 * `data-sidebar-slot` container rendered by the AppShell), or null when
 * none is mounted — e.g. below md before the drawer has been opened.
 *
 * Portal usage from a children route (mounts after the shell, so the
 * first render may see null and re-render once the slot registers):
 *
 * ```tsx
 * const slot = useSidebarSlot()
 * return slot === null ? null : createPortal(<MyModule />, slot)
 * ```
 *
 * To REPLACE the default nav instead of appending to it, use
 * {@link useClaimSidebarSlot} — the shell hides its default nav while the
 * slot is claimed.
 */
export function useSidebarSlot(): HTMLElement | null {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Like {@link useSidebarSlot}, but additionally claims the slot while the
 * caller is mounted: the AppShell suppresses its default nav, so the
 * portaled module (e.g. the document tree) takes over the nav area.
 */
export function useClaimSidebarSlot(): HTMLElement | null {
	const slot = useSidebarSlot()
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
export function useSidebarSlotClaimed(): boolean {
	return useSyncExternalStore(
		subscribe,
		getClaimedSnapshot,
		getClaimedServerSnapshot,
	)
}
