import { queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { trpcMutation, trpcQuery, trpcQueryOptions } from "@/trpc/factory"

export const dataHistoryKeys = {
	all: ["data-history"] as const,
	list: () => [...dataHistoryKeys.all, "list"] as const,
	autoStatus: () => [...dataHistoryKeys.all, "auto-status"] as const,
}

export type BackupEvent = {
	readonly kind: "backup"
	readonly id: string
	readonly fileName: string
	/**
	 * True when produced by the automatic daily snapshot scheduler rather
	 * than the user's "Back up now" action.
	 */
	readonly auto: boolean
	readonly name?: string
	readonly note?: string
	readonly size: number
	readonly createdAt: number
	readonly activeVersionAtCreate: number
	/** Live-entity counts recorded at snapshot time. */
	readonly counts?: { resources: number; characters: number; documents: number }
}

export type ArchiveEvent = {
	readonly kind: "archive"
	readonly id: string
	readonly version: number
	readonly createdAt?: number
	readonly name?: string
	readonly note?: string
	readonly dbSize: number
	readonly current: boolean
	readonly active: boolean
}

export type HistoryGroup = {
	readonly archive: ArchiveEvent
	readonly backups: BackupEvent[]
}

export type DataHistoryList = {
	readonly groups: HistoryGroup[]
	readonly currentVersion: number
	readonly activeVersion: number
}

export function dataHistoryListQueryOptions() {
	return queryOptions({
		queryKey: dataHistoryKeys.list(),
		queryFn: async () => {
			const [backups, versions] = await Promise.all([
				trpcQuery("backup", "list", undefined),
				trpcQuery("version", "list", undefined),
			])

			const currentVersion =
				versions.find((v) => v.current)?.version ??
				Math.max(0, ...versions.map((v) => v.version))
			const activeVersion =
				versions.find((v) => v.active)?.version ?? currentVersion

			const versionMap = new Map<number, ArchiveEvent>()
			for (const v of versions) {
				versionMap.set(v.version, {
					kind: "archive",
					id: `archive-${v.version}`,
					version: v.version,
					createdAt: v.createdAt,
					name: v.name,
					note: v.note,
					dbSize: v.dbSize,
					current: v.current,
					active: v.active,
				})
			}

			const backupEvents: BackupEvent[] = backups.map((b) => ({
				kind: "backup",
				id: `backup-${b.fileName}`,
				fileName: b.fileName,
				auto: b.kind === "auto",
				name: b.name,
				note: b.note,
				size: b.size,
				createdAt: b.createdAt,
				activeVersionAtCreate: b.activeVersion ?? currentVersion,
				counts: b.counts,
			}))

			// Group backups by the version that was active when they were created.
			const backupsByVersion = new Map<number, BackupEvent[]>()
			for (const b of backupEvents) {
				const list = backupsByVersion.get(b.activeVersionAtCreate) ?? []
				list.push(b)
				backupsByVersion.set(b.activeVersionAtCreate, list)
			}

			// Sort each group's backups newest-first.
			for (const list of backupsByVersion.values()) {
				list.sort((a, b) => b.createdAt - a.createdAt)
			}

			// Sort groups by version descending (newest version at top).
			const groups: HistoryGroup[] = versions
				.map((v) => ({
					archive: versionMap.get(v.version) as ArchiveEvent,
					backups: backupsByVersion.get(v.version) ?? [],
				}))
				.sort((a, b) => b.archive.version - a.archive.version)

			return {
				groups,
				currentVersion,
				activeVersion,
			}
		},
		staleTime: 2_000,
	})
}

export function autoStatusQueryOptions() {
	return trpcQueryOptions({
		namespace: "backup",
		procedure: "autoStatus",
		input: undefined,
		queryKey: dataHistoryKeys.autoStatus(),
		staleTime: 10_000,
	})
}

export const invalidateDataHistory = makeInvalidator({
	all: dataHistoryKeys.all,
})

export function createBackupMutation() {
	return trpcMutation("backup", "create")
}

export function createVersionMutation() {
	return trpcMutation("version", "create", {
		transform: (input: { readonly note?: string }) => ({
			confirmArchive: true as const,
			note: input.note,
		}),
	})
}

export function restoreBackupMutation() {
	return trpcMutation("backup", "restore", {
		transform: (fileName: string) => ({ fileName }),
	})
}

export function deleteBackupMutation() {
	return trpcMutation("backup", "delete", {
		transform: (fileName: string) => ({ fileName }),
	})
}

export function switchVersionMutation() {
	return trpcMutation("version", "switchTo", {
		transform: (version: number) => ({ version }),
	})
}

export function updateBackupMetaMutation() {
	return trpcMutation("backup", "updateMeta")
}

export function updateVersionMetaMutation() {
	return trpcMutation("version", "updateMeta")
}
