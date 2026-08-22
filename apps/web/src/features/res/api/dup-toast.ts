/**
 * One-shot notifications for "a resource's hash rebuild finished".
 * The server broadcasts `resourceMetaUpdated` with `metaTypes`
 * containing `imageHashes` once the owning plugin's hash hook ran;
 * the SSE handler in `__root` routes that here. The upload flow
 * subscribes before/as it commits so it can surface duplicate warnings
 * after the async rebuild completes — hashes are never ready at commit
 * time, so this event is the only timely signal.
 *
 * Listeners are per-resource and fire once, then unsubscribe themselves.
 * A listener whose event never arrives (e.g. the owning plugin provides
 * no hashes and the marker never changes) lingers until the subscriber
 * disposes it — callers should track the returned unsubscribe fn for
 * component unmount.
 */

type Listener = {
	readonly resId: string
	readonly notify: () => void
}

const listeners = new Set<Listener>()

/** Notify every listener waiting on `resId` (called from the SSE handler). */
export function notifyImageHashesReady(resId: string): void {
	for (const listener of listeners) {
		if (listener.resId === resId) {
			listeners.delete(listener)
			listener.notify()
		}
	}
}

/**
 * Run `notify` once when the hash rebuild of `resId` finishes.
 * Returns an unsubscribe function (call it on unmount so a never-firing
 * listener cannot leak).
 */
export function onImageHashesReady(
	resId: string,
	notify: () => void,
): () => void {
	const listener: Listener = { resId, notify }
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Test helper: forget every registered listener. */
export function clearImageHashesListeners(): void {
	listeners.clear()
}
