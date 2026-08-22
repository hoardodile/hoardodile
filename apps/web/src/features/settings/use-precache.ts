import { useCallback, useReducer } from "react"
import { prefetchImages } from "@/lib/prefetch-images"
import { streamSse } from "@/lib/sse"
import { precacheAbort, precacheStart, precacheStream } from "./api"

type Phase = "resources" | "characters" | null

type ProgressState = {
	readonly phase: Phase
	readonly current: number
	readonly total: number
}

type WarmState = {
	readonly done: number
	readonly total: number
}

export type PrecachePhaseResult = {
	readonly total: number
	readonly succeeded: number
	readonly failed: number
	readonly errors: readonly { id: string; error: string }[]
	readonly thumbUrls: readonly string[]
}

export type PrecacheResult = {
	readonly resources: PrecachePhaseResult
	readonly characters: PrecachePhaseResult
}

export type PrecacheStatus =
	| "checking"
	| "idle"
	| "streaming"
	| "warming"
	| "done"
	| "error"
	| "aborted"

export type PrecacheState = {
	readonly status: PrecacheStatus
	readonly progress: ProgressState
	readonly warming: WarmState
	readonly result: PrecacheResult | null
	readonly error: string | null
	readonly conflict: boolean
}

export type PrecacheAction =
	| { readonly type: "start" }
	| { readonly type: "resume" }
	| { readonly type: "resume-failed" }
	| { readonly type: "phase"; readonly phase: Phase; readonly total: number }
	| {
			readonly type: "progress"
			readonly phase: Phase
			readonly current: number
			readonly total: number
	  }
	| { readonly type: "done"; readonly result: PrecacheResult }
	| { readonly type: "server-idle" }
	| { readonly type: "aborted" }
	| { readonly type: "error"; readonly error: string }
	| { readonly type: "conflict" }
	| { readonly type: "stream-lost" }
	| { readonly type: "warm-start"; readonly total: number }
	| { readonly type: "warm-progress"; readonly done: number }
	| { readonly type: "warm-done" }

const EMPTY_PROGRESS: ProgressState = { phase: null, current: 0, total: 0 }
const EMPTY_WARMING: WarmState = { done: 0, total: 0 }

export const initialPrecacheState: PrecacheState = {
	status: "checking",
	progress: EMPTY_PROGRESS,
	warming: EMPTY_WARMING,
	result: null,
	error: null,
	conflict: false,
}

export function precacheReducer(
	state: PrecacheState,
	action: PrecacheAction,
): PrecacheState {
	switch (action.type) {
		case "start":
			return { ...initialPrecacheState, status: "streaming" }
		case "resume":
			// Stay in checking while we ask the server whether a run is
			// active — the buttons render as loading in the meantime (and are
			// disabled, which also blocks a racing manual click). Real
			// phase/progress events flip the status to streaming.
			return { ...state, status: "checking", error: null, conflict: false }
		case "resume-failed":
			return { ...state, status: "idle" }
		case "phase":
			return {
				...state,
				status: "streaming",
				progress: { phase: action.phase, current: 0, total: action.total },
			}
		case "progress":
			return {
				...state,
				status: "streaming",
				progress: {
					phase: action.phase,
					current: action.current,
					total: action.total,
				},
			}
		case "done":
			return { ...state, status: "done", result: action.result }
		case "server-idle":
			return { ...state, status: "idle" }
		case "aborted":
			return { ...state, status: "aborted", progress: EMPTY_PROGRESS }
		case "error":
			return { ...state, status: "error", error: action.error }
		case "conflict":
			return {
				...state,
				status: "error",
				conflict: true,
				error: "Precache already in progress",
			}
		case "stream-lost":
			// A finished run keeps its result; only mid-stream disconnects error.
			return state.status === "done"
				? state
				: { ...state, status: "error", error: "Stream disconnected" }
		case "warm-start":
			return {
				...state,
				status: "warming",
				warming: { done: 0, total: action.total },
			}
		case "warm-progress":
			return { ...state, warming: { ...state.warming, done: action.done } }
		case "warm-done":
			return { ...state, status: "done" }
	}
}

const PREFETCH_LANES = 6

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

function readPhase(value: unknown): Phase {
	return value === "resources" || value === "characters" ? value : null
}

function readNumber(value: unknown): number {
	return typeof value === "number" ? value : 0
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : ""
}

function isPhaseResult(value: unknown): value is PrecachePhaseResult {
	if (!isRecord(value)) return false
	return (
		typeof value.total === "number" &&
		typeof value.failed === "number" &&
		Array.isArray(value.thumbUrls)
	)
}

function isPrecacheResult(value: unknown): value is PrecacheResult {
	if (!isRecord(value)) return false
	return isPhaseResult(value.resources) && isPhaseResult(value.characters)
}

/**
 * Map an SSE event to a reducer action. "done" is handled separately by the
 * caller because its result must also be captured outside the reducer.
 * Returns null for events the caller chose to ignore.
 */
function precacheEventToAction(
	event: string,
	data: unknown,
): PrecacheAction | null {
	switch (event) {
		case "phase":
			if (!isRecord(data)) return null
			return {
				type: "phase",
				phase: readPhase(data.phase),
				total: readNumber(data.total),
			}
		case "progress":
			if (!isRecord(data)) return null
			return {
				type: "progress",
				phase: readPhase(data.phase),
				current: readNumber(data.current),
				total: readNumber(data.total),
			}
		case "idle":
			return { type: "server-idle" }
		case "aborted":
			return { type: "aborted" }
		case "error":
			return {
				type: "error",
				error: isRecord(data) ? readString(data.message) : "",
			}
		default:
			return null
	}
}

export function usePrecache() {
	const [state, dispatch] = useReducer(precacheReducer, initialPrecacheState)

	const start = useCallback(async (): Promise<PrecacheResult | null> => {
		dispatch({ type: "start" })

		let response: Response
		try {
			response = await precacheStart()
		} catch (err) {
			dispatch({
				type: "error",
				error: err instanceof Error ? err.message : "Network error",
			})
			return null
		}

		if (response.status === 409) {
			dispatch({ type: "conflict" })
			return null
		}

		if (!response.ok || response.body === null) {
			dispatch({ type: "error", error: `Server error: ${response.status}` })
			return null
		}

		let result: PrecacheResult | null = null
		let thumbUrls: readonly string[] = []

		try {
			await streamSse(response.body, ({ event, data }) => {
				if (event === "done") {
					if (isPrecacheResult(data)) {
						result = data
						thumbUrls = [
							...data.resources.thumbUrls,
							...data.characters.thumbUrls,
						]
						dispatch({ type: "done", result: data })
					}
					return
				}
				// "idle" is only emitted by the resume stream — ignore it here.
				if (event === "idle") return
				const action = precacheEventToAction(event, data)
				if (action !== null) dispatch(action)
			})
		} catch {
			dispatch({ type: "stream-lost" })
		}

		if (thumbUrls.length > 0) {
			dispatch({ type: "warm-start", total: thumbUrls.length })
			await prefetchImages(thumbUrls, PREFETCH_LANES, (done) => {
				dispatch({ type: "warm-progress", done })
			})
			dispatch({ type: "warm-done" })
		}

		return result
	}, [])

	const abort = useCallback(async () => {
		try {
			const response = await precacheAbort()
			return response.ok
		} catch {
			return false
		}
	}, [])

	const resumeIfRunning = useCallback(async () => {
		dispatch({ type: "resume" })

		let response: Response
		try {
			response = await precacheStream()
		} catch {
			dispatch({ type: "resume-failed" })
			return
		}

		if (!response.ok || response.body === null) {
			dispatch({ type: "resume-failed" })
			return
		}

		try {
			await streamSse(response.body, ({ event, data }) => {
				if (event === "done") {
					if (isPrecacheResult(data)) {
						dispatch({ type: "done", result: data })
					}
					return
				}
				const action = precacheEventToAction(event, data)
				if (action !== null) dispatch(action)
			})
		} catch {
			// stream disconnected — last rendered progress remains visible
		}
	}, [])

	return { state, start, abort, resumeIfRunning }
}
