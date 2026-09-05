import { EventEmitter } from "eventemitter3"

/**
 * Server-internal signals are infrastructure-level notifications that never
 * cross the wire. Subscribers are typed per-key.
 */

export type ServerSignals = {
	/** The selected archive changed; reload the library context in this process. */
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
