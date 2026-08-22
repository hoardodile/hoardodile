import type { ResourceAPI } from "../types.ts"

/**
 * A hook invocation awaiting a worker response. Carries the call's
 * progress state plus the two timers policing it: the inactivity
 * watchdog and the absolute hard timeout.
 */
export type PendingCall = {
	readonly api: ResourceAPI
	readonly resolve: (value: unknown) => void
	readonly reject: (err: Error) => void
	/**
	 * Host-side API dispatches currently running for this call. While any
	 * are in flight the watchdog is paused — the plugin is blocked on the
	 * host, not hung.
	 */
	apiInFlight: number
	watchdog?: NodeJS.Timeout
	hardTimer?: NodeJS.Timeout
}

export type CallTimers = {
	/** (Re)arm the inactivity watchdog, replacing any previous one. */
	readonly armWatchdog: (call: PendingCall, onExpire: () => void) => void
	/** Arm the absolute per-invocation cap. */
	readonly armHardTimer: (call: PendingCall, onExpire: () => void) => void
	/** Suspend the watchdog while host-side API work is in flight. */
	readonly pauseWatchdog: (call: PendingCall) => void
	/** Cancel both timers of a call (settled or abandoned). */
	readonly clearCallTimers: (call: PendingCall) => void
}

/**
 * Timer bookkeeping for sandboxed hook invocations: the inactivity
 * watchdog (`watchdogMs`) and the absolute cap (`hardTimeoutMs`). Expiry
 * callbacks are supplied per arm by the owner — which knows the owning
 * state and worker — so this module stays decoupled from the sandbox
 * lifecycle.
 */
export function createCallTimers(opts: {
	readonly watchdogMs: number
	readonly hardTimeoutMs: number
}): CallTimers {
	function armWatchdog(call: PendingCall, onExpire: () => void): void {
		if (call.watchdog !== undefined) clearTimeout(call.watchdog)
		call.watchdog = setTimeout(onExpire, opts.watchdogMs)
		call.watchdog.unref()
	}

	function armHardTimer(call: PendingCall, onExpire: () => void): void {
		if (call.hardTimer !== undefined) clearTimeout(call.hardTimer)
		call.hardTimer = setTimeout(onExpire, opts.hardTimeoutMs)
		call.hardTimer.unref()
	}

	function pauseWatchdog(call: PendingCall): void {
		if (call.watchdog === undefined) return
		clearTimeout(call.watchdog)
		call.watchdog = undefined
	}

	function clearCallTimers(call: PendingCall): void {
		if (call.watchdog !== undefined) clearTimeout(call.watchdog)
		if (call.hardTimer !== undefined) clearTimeout(call.hardTimer)
	}

	return { armWatchdog, armHardTimer, pauseWatchdog, clearCallTimers }
}
