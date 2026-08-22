import { useEffect, useRef, useState } from "react"
import { usePluginAPI } from "./context.tsx"

/**
 * Polling interval for {@link useExtractProgress}. The host's progress
 * record lives in memory with a short TTL, so the poll must be tight
 * enough to catch a row before it expires.
 */
const POLL_INTERVAL_MS = 300

/**
 * Materialization progress of the plugin's `extractArchive` hook:
 * `"extracting"` while the host reports in-flight work, `"done"` once
 * progress was seen and the record went idle again, `"idle"` when no
 * extraction has ever been observed (or a poll failed — the host may
 * not be serving yet).
 */
export type ExtractProgressState =
	| { readonly state: "idle" }
	| {
			readonly state: "extracting"
			readonly done: number
			readonly total: number
	  }
	| { readonly state: "done" }

/**
 * Reactive materialization progress for the current resource. Polls
 * `api.extractProgressUrl()` and tracks the seen-progress transition:
 * a plugin that called `extractArchive` can show "extracting" while the
 * host materializes, then switch to "done" when the record expires.
 */
export function useExtractProgress(): ExtractProgressState {
	const api = usePluginAPI()
	const [state, setState] = useState<ExtractProgressState>({ state: "idle" })
	const seenProgress = useRef(false)

	useEffect(
		function pollProgress() {
			let cancelled = false
			seenProgress.current = false
			setState({ state: "idle" })

			async function poll(): Promise<void> {
				let payload: unknown
				try {
					const response = await fetch(api.extractProgressUrl())
					payload = await response.json()
				} catch {
					// A failed poll (host not serving yet) is treated as idle.
					payload = null
				}
				if (cancelled) return
				if (payload !== null && typeof payload === "object") {
					const { done, total } = payload as Record<string, unknown>
					if (typeof done === "number" && typeof total === "number") {
						seenProgress.current = true
						setState({ state: "extracting", done, total })
						return
					}
				}
				setState(seenProgress.current ? { state: "done" } : { state: "idle" })
			}

			void poll()
			const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
			return () => {
				cancelled = true
				clearInterval(timer)
			}
		},
		[api],
	)

	return state
}
