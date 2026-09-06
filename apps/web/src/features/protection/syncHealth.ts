import { useQuery } from "@tanstack/react-query"
import { syncSummaryQueryOptions } from "@/features/sync/api"
import { replicationStatusOptions } from "./api"

/**
 * Connected-device health: paired services and whether their last
 * received backup is due. The reminder interval lives in the sync
 * summary (host pref); due = never received or past the interval.
 */
export function useSyncHealth() {
	const replication = useQuery(replicationStatusOptions()).data
	const summary = useQuery(syncSummaryQueryOptions()).data
	const connected = replication?.source
		? [replication.source]
		: (replication?.peers ?? [])
	const threshold = (summary?.remindDays ?? 7) * 86400_000
	const dueConnections = connected.filter(
		(entry) => !entry.receivedAt || Date.now() - entry.receivedAt > threshold,
	)
	const dueCount = dueConnections.length
	return {
		loaded: replication !== undefined,
		connected,
		dueConnections,
		count: connected.length,
		dueCount,
		paused: replication?.paused ?? false,
		labelKey:
			dueCount || replication?.paused
				? "replication.healthAttention"
				: connected.length
					? "replication.healthReceived"
					: "replication.healthUnconfigured",
	}
}
