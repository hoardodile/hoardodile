import type { ClientPlatform, UsageEntityType } from "@hoardodile/schemas"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { randomUUID } from "@/lib/randomUUID"
import { recordUsageSessionBeatMutation } from "./api"
import { enqueueUsageBeat, flushUsageBeats } from "./beatQueue"
import { detectPlatform } from "./detectPlatform"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000

export type UseUsageSessionRecorderOptions = {
	readonly entityType: UsageEntityType
	readonly entityId: string
	readonly tracking: boolean
	readonly heartbeatIntervalMs?: number
}

/**
 * Record usage session heartbeats while `tracking` is true and the browser
 * tab is visible.
 */
export function useUsageSessionRecorder(
	options: UseUsageSessionRecorderOptions,
): void {
	const {
		entityType,
		entityId,
		tracking,
		heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
	} = options

	const mutation = useMutation(recordUsageSessionBeatMutation())
	const sessionRef = useRef<{
		sessionId: string
		startedAt: number
		entityType: UsageEntityType
		entityId: string
		platform: ClientPlatform
	} | null>(null)
	const pendingMsRef = useRef(0)

	function startSession(): void {
		if (sessionRef.current !== null) return
		sessionRef.current = {
			sessionId: randomUUID(),
			startedAt: Date.now(),
			entityType,
			entityId,
			platform: detectPlatform(),
		}
		pendingMsRef.current = 0
	}

	async function flush(): Promise<void> {
		const session = sessionRef.current
		if (session === null) return
		const accrued = pendingMsRef.current
		if (accrued <= 0) return
		await enqueueUsageBeat({
			sessionId: session.sessionId,
			entityType: session.entityType,
			entityId: session.entityId,
			startedAt: session.startedAt,
			durationMs: accrued,
			platform: session.platform,
		})
		await flushUsageBeats((beat) => mutation.mutateAsync(beat))
	}

	function resetSession(): void {
		void flush()
		sessionRef.current = null
	}

	useEffect(() => {
		if (!tracking) return
		if (document.visibilityState !== "visible") return

		startSession()

		const intervalId = setInterval(() => {
			if (document.visibilityState !== "visible") return
			pendingMsRef.current += heartbeatIntervalMs
			void flush()
		}, heartbeatIntervalMs)

		function handleVisibility() {
			if (document.visibilityState === "hidden") {
				void flush()
			} else if (tracking) {
				startSession()
			}
		}

		function handlePageHide() {
			void flush()
		}

		document.addEventListener("visibilitychange", handleVisibility)
		window.addEventListener("pagehide", handlePageHide)
		window.addEventListener("beforeunload", handlePageHide)

		return () => {
			clearInterval(intervalId)
			document.removeEventListener("visibilitychange", handleVisibility)
			window.removeEventListener("pagehide", handlePageHide)
			window.removeEventListener("beforeunload", handlePageHide)
			resetSession()
		}
	}, [tracking, heartbeatIntervalMs, entityType, entityId])
}
