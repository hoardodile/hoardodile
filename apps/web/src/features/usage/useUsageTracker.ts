import type { UsageEntityType } from "@hoardodile/schemas"
import { useActiveGate } from "./useActiveGate"
import { useIdleGate } from "./useIdleGate"
import { useUsageSessionRecorder } from "./useUsageSessionRecorder"

export type UseUsageTrackerOptions = {
	readonly entityType: UsageEntityType
	readonly entityId: string
	readonly enabled?: boolean
	/**
	 * Additional gate for whether the viewed content is actively on screen
	 * (e.g. plugin iframe intersecting the viewport). Defaults to true.
	 */
	readonly active?: boolean
	readonly heartbeatIntervalMs?: number
}

/**
 * Send usage session beats while the entity is actively viewed.
 *
 * Heartbeats are first written to a local queue (IndexedDB when available) and
 * then flushed to the server. This prevents data loss during brief network
 * interruptions or page transitions.
 */
export function useUsageTracker(options: UseUsageTrackerOptions): void {
	const idle = useIdleGate()
	const tracking = useActiveGate({
		enabled: options.enabled,
		active: options.active,
		idle,
	})

	useUsageSessionRecorder({
		entityType: options.entityType,
		entityId: options.entityId,
		tracking,
		heartbeatIntervalMs: options.heartbeatIntervalMs,
	})
}
