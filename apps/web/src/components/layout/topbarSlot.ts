import { useSyncExternalStore } from "react"

let currentSlot: HTMLElement | null = null
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
