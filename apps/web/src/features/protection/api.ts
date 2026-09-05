import { queryOptions } from "@tanstack/react-query"
import type { RouterOutputs } from "@/trpc/client"
import { trpcQueryOptions } from "@/trpc/factory"

export type RecoveryPoint = RouterOutputs["protection"]["points"][number]
export type ProtectionJob = RouterOutputs["protection"]["jobs"][number]

export const protectionStatusOptions = () => ({
	...trpcQueryOptions({
		namespace: "protection",
		procedure: "status",
		input: undefined,
		queryKey: ["protection", "status"],
	}),
	refetchInterval: 2000,
})
export const protectionJobsOptions = () => ({
	...trpcQueryOptions({
		namespace: "protection",
		procedure: "jobs",
		input: undefined,
		queryKey: ["protection", "jobs"],
	}),
	refetchInterval: 1000,
})
export const recoveryPointsOptions = (repositoryId: string) => ({
	...trpcQueryOptions({
		namespace: "protection",
		procedure: "points",
		input: { repositoryId },
		queryKey: ["protection", "points", repositoryId],
	}),
	refetchInterval: 10_000,
})
export const replicationStatusOptions = () => ({
	...trpcQueryOptions({
		namespace: "replication",
		procedure: "status",
		input: undefined,
		queryKey: ["replication", "status"],
	}),
	refetchInterval: 3000,
})
export const maintenanceOptions = () =>
	queryOptions({
		queryKey: ["library-maintenance"],
		queryFn: async () => {
			const response = await fetch("/api/protection/state", {
				credentials: "same-origin",
				cache: "no-store",
			})
			if (!response.ok) throw new Error("The service is unavailable")
			const state: unknown = await response.json()
			return Boolean(
				state &&
					typeof state === "object" &&
					"maintenance" in state &&
					state.maintenance,
			)
		},
		refetchInterval: 1500,
		retry: false,
	})

export function downloadRecoveryKey(
	value: unknown,
	repositoryId: string,
): void {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
	)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = `hoardodile-recovery-${repositoryId}.json`
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
