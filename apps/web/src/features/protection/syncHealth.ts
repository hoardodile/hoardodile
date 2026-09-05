import { useQuery } from "@tanstack/react-query"
import { syncSummaryQueryOptions } from "@/features/sync/api"
import { replicationStatusOptions } from "./api"

/** Manual records and confirmed backup receipts remain distinct status sources. */
export function useSyncHealth() {
	const summary = useQuery(syncSummaryQueryOptions()).data
	const replication = useQuery(replicationStatusOptions()).data
	const links = replication?.links ?? {}
	const manual =
		summary?.devices.filter((entry) => !links[entry.device.id]) ?? []
	const connected = replication?.source
		? [replication.source]
		: (replication?.peers ?? [])
	const threshold = (summary?.remindDays ?? 7) * 86400_000
	const dueConnections = connected.filter(
		(entry) => !entry.receivedAt || Date.now() - entry.receivedAt > threshold,
	)
	const dueCount =
		manual.filter((entry) => entry.due).length + dueConnections.length
	return {
		loaded: summary !== undefined || replication !== undefined,
		summary,
		manual,
		connected,
		dueConnections,
		count: manual.length + connected.length,
		dueCount,
		paused: replication?.paused ?? false,
		labelKey:
			dueCount || replication?.paused
				? "replication.healthAttention"
				: connected.length
					? "replication.healthReceived"
					: manual.length
						? "replication.healthRecorded"
						: "replication.healthUnconfigured",
	}
}
