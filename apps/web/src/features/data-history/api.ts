import { queryOptions } from "@tanstack/react-query"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation, trpcQuery } from "@/trpc/factory"

export const dataHistoryKeys = {
	all: ["data-history"] as const,
	list: () => [...dataHistoryKeys.all, "list"] as const,
}
export type ArchiveEvent = RouterOutputs["version"]["list"][number] & {
	readonly id: string
}
export type DataHistoryList = {
	readonly archives: ArchiveEvent[]
	readonly currentVersion: number
	readonly activeVersion: number
}
export function dataHistoryListQueryOptions() {
	return queryOptions({
		queryKey: dataHistoryKeys.list(),
		queryFn: async (): Promise<DataHistoryList> => {
			const versions = await trpcQuery("version", "list", undefined)
			const currentVersion =
				versions.find((entry) => entry.current)?.version ?? 0
			return {
				archives: versions
					.map((entry) => ({ ...entry, id: `archive-${entry.version}` }))
					.sort((a, b) => b.version - a.version),
				currentVersion,
				activeVersion:
					versions.find((entry) => entry.active)?.version ?? currentVersion,
			}
		},
		staleTime: 2000,
	})
}
export function switchVersionMutation() {
	return trpcMutation("version", "switchTo", {
		transform: (version: number) => ({ version }),
	})
}
export function updateVersionMetaMutation() {
	return trpcMutation("version", "updateMeta")
}
