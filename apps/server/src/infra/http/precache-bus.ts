import { EventEmitter } from "eventemitter3"

export type PrecacheBusEvent = {
	readonly event: string
	readonly data: unknown
}

export type PrecacheBus = {
	isRunning(): boolean
	isAborted(): boolean
	getLastProgress(): PrecacheBusEvent | null
	getResult(): Record<string, unknown> | null
	getError(): string | null
	emit(event: string, data: unknown): void
	subscribe(cb: (evt: PrecacheBusEvent) => void): () => void
	start(): void
	finish(result: Record<string, unknown>): void
	fail(message: string): void
	abort(): void
	reset(): void
}

type PrecacheBusEvents = {
	precache: [PrecacheBusEvent]
}

function createPrecacheBus(): PrecacheBus {
	const ee = new EventEmitter<PrecacheBusEvents>()

	let running = false
	let aborted = false
	let lastProgress: PrecacheBusEvent | null = null
	let result: Record<string, unknown> | null = null
	let error: string | null = null

	function emit(event: string, data: unknown): void {
		const evt: PrecacheBusEvent = { event, data }
		if (event === "phase" || event === "progress") {
			lastProgress = evt
		}
		if (event === "done" || event === "error" || event === "aborted") {
			running = false
		}
		ee.emit("precache", evt)
	}

	function subscribe(cb: (evt: PrecacheBusEvent) => void): () => void {
		function safeCb(evt: PrecacheBusEvent): void {
			try {
				cb(evt)
			} catch {
				// listener errors must not halt fan-out
			}
		}
		ee.on("precache", safeCb)
		return function off() {
			ee.off("precache", safeCb)
		}
	}

	function start(): void {
		running = true
		aborted = false
		lastProgress = null
		result = null
		error = null
	}

	function finish(r: Record<string, unknown>): void {
		result = r
		emit("done", r)
	}

	function fail(message: string): void {
		error = message
		emit("error", { message })
	}

	function abort(): void {
		aborted = true
	}

	function reset(): void {
		running = false
		aborted = false
		lastProgress = null
		result = null
		error = null
		ee.removeAllListeners()
	}

	return {
		isRunning() {
			return running
		},
		isAborted() {
			return aborted
		},
		getLastProgress() {
			return lastProgress
		},
		getResult() {
			return result
		},
		getError() {
			return error
		},
		emit,
		subscribe,
		start,
		finish,
		fail,
		abort,
		reset,
	}
}

export const precacheBus = createPrecacheBus()
