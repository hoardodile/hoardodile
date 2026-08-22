import { useEffect, useSyncExternalStore } from "react"

let currentSlot: HTMLElement | null = null
let claimCount = 0
const listeners = new Set<() => void>()

function notify() {
	for (const listener of listeners) listener()
}

/**
 * Callback-ref target for the shell's mobile top-bar actions slot (the
 * `data-topbar-slot` container inside the AppShell's below-md top row).
 * The row is single-instance, so at most one slot exists at a time.
 */
export function registerTopbarSlot(el: HTMLElement | null) {
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
 * Returns the shell's mobile top-bar actions slot, or null when none is
 * mounted. Route chrome (e.g. the document detail header) portals its
 * compact actions into it below md instead of rendering its own bar:
 *
 * ```tsx
 * const slot = useTopbarSlot()
 * if (!isMobile) return <FullBar />
 * return slot === null ? null : createPortal(<CompactActions />, slot)
 * ```
 */
export function useTopbarSlot(): HTMLElement | null {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Claims the top-bar row while the caller is mounted. On desktop the
 * AppShell renders the row only while a route claims it — the row's only
 * desktop use is route chrome (the global sidebar toggle lives in the
 * caption strip), so an unclaimed row would sit empty.
 */
export function useClaimTopbarSlot(): void {
	useEffect(() => {
		claimCount += 1
		notify()
		return () => {
			claimCount -= 1
			notify()
		}
	}, [])
}

/** Internal to the AppShell: whether a route module claimed the row. */
export function useTopbarSlotClaimed(): boolean {
	return useSyncExternalStore(
		subscribe,
		getClaimedSnapshot,
		getClaimedServerSnapshot,
	)
}
