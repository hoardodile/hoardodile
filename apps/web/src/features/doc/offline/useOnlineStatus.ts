import { useSyncExternalStore } from "react"

type Listener = () => void

const listeners = new Set<Listener>()

let browserOnline = typeof navigator === "undefined" ? true : navigator.onLine
let networkFailed = false

function emit(): void {
	for (const listener of listeners) listener()
}

function getOnline(): boolean {
	return browserOnline && !networkFailed
}

function subscribe(listener: Listener): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/**
 * Marks the network as unavailable after a request failed at the
 * transport level (e.g. a save that never reached the server). The
 * browser's `online` event or a later successful save clears it.
 */
export function markNetworkOffline(): void {
	if (networkFailed) return
	networkFailed = true
	emit()
}

/** Clears the failure-based offline flag after a successful save. */
export function markNetworkOnline(): void {
	if (!networkFailed) return
	networkFailed = false
	emit()
}

if (typeof window !== "undefined") {
	window.addEventListener("online", () => {
		browserOnline = true
		networkFailed = false
		emit()
	})
	window.addEventListener("offline", () => {
		browserOnline = false
		emit()
	})
}

/**
 * Reactive view of the effective online state: the browser's
 * `online`/`offline` signal ANDed with the failure-based flag.
 */
export function useOnlineStatus(): boolean {
	return useSyncExternalStore(subscribe, getOnline, () => true)
}
