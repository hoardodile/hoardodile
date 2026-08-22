import { EventEmitter } from "eventemitter3"

/**
 * Server-internal signals are infrastructure-level notifications that never
 * cross the wire. Subscribers are typed per-key.
 */

export type ServerSignals = {
	/**
	 * A restore has been staged on disk. The server should close itself and
	 * the caller is expected to apply the pending swap and re-open a fresh
	 * instance. The payload is intentionally empty -- the marker file on
	 * disk is the single source of truth for the pending restore.
	 */
	readonly "backup.restoreRequested": undefined
	/**
	 * The active archive version has changed (either a new version was
	 * created or the user switched to a different one). The server
	 * should close itself so a fresh instance picks up the new
	 * `version-state.json`. Payload is empty for the same reason as
	 * `backup.restoreRequested` — the on-disk state is the truth.
	 */
	readonly "version.changed": undefined
}

type Listener<T> = (payload: T) => void

// eventemitter3's generic expects a record of arg-tuples per event.
type SignalEventsMap = {
	[K in keyof ServerSignals]: [ServerSignals[K]]
}

export type SignalEmitter = {
	readonly emit: <K extends keyof ServerSignals>(
		signal: K,
		payload: ServerSignals[K],
	) => void
	readonly on: <K extends keyof ServerSignals>(
		signal: K,
		listener: Listener<ServerSignals[K]>,
	) => () => void
}

export function createSignalEmitter(): SignalEmitter {
	const ee = new EventEmitter<SignalEventsMap>()

	function emit<K extends keyof ServerSignals>(
		signal: K,
		payload: ServerSignals[K],
	): void {
		ee.emit(signal, payload)
	}

	function on<K extends keyof ServerSignals>(
		signal: K,
		listener: Listener<ServerSignals[K]>,
	): () => void {
		// Wrap to preserve the "listener errors must not halt fan-out" guarantee;
		// eventemitter3 propagates synchronous throws from listeners.
		function safeListener(payload: ServerSignals[K]): void {
			try {
				listener(payload)
			} catch {
				// listener errors must not halt fan-out
			}
		}
		ee.on(signal, safeListener)
		return function off(): void {
			ee.off(signal, safeListener)
		}
	}

	return { emit, on }
}
