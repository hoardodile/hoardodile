import { z } from "zod"

export const safeRelativePath = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes("\\") &&
			!value.includes("\0") &&
			!value.startsWith("/") &&
			!value.includes(":") &&
			value
				.split("/")
				.every((part) => part !== "" && part !== "." && part !== ".."),
		"Expected a confined relative path",
	)

export const recoveryManifest = z
	.object({
		formatVersion: z.literal(1),
		recoveryPointId: z.uuid(),
		libraryId: z.uuid(),
		instanceId: z.uuid(),
		createdAt: z.number().int().positive(),
		appVersion: z.string().min(1),
		latestVersion: z.number().int().positive(),
		databasePath: safeRelativePath,
		databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
		databaseSchema: z.string(),
		plugins: z.array(
			z.object({
				id: z.string().min(1),
				version: z.string(),
				archiveVersion: z.number().int().positive(),
				manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		),
	})
	.strict()

export type RecoveryManifest = z.infer<typeof recoveryManifest>
export const recoveryHeader = recoveryManifest.omit({ plugins: true }).extend({
	pluginCount: z.number().int().nonnegative(),
	manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export type RecoveryHeader = z.infer<typeof recoveryHeader>
export const recoveryMetadata = z.object({
	name: z.string().max(200).default(""),
	note: z.string().max(2000).default(""),
	kind: z.enum(["manual", "auto"]),
	pinned: z.boolean(),
	revision: z.number().int().nonnegative().optional(),
})
export type RecoveryMetadata = z.infer<typeof recoveryMetadata>

export type RecoveryPoint = RecoveryMetadata & {
	id: string
	snapshotId: string
	createdAt: number
	manifest: RecoveryHeader
	totalBytes?: number
	newBytes?: number
	fileCount?: number
}

export type Repository = {
	id: string
	path: string
	passwordFile: string
}

export type CommandOptions = {
	signal?: AbortSignal
	onProgress?: (event: unknown) => void
}

export type SourceDifference = {
	path: string
	status: "missing" | "changed" | "extra"
}

export const retentionPolicy = z.object({
	/**
	 * Newest automatic recovery points kept per library. Manual and pinned
	 * points, the newest point, and points protected by a running operation
	 * are never selected for removal.
	 */
	automatic: z.number().int().min(1).max(365).default(3),
})
export type RetentionPolicy = z.infer<typeof retentionPolicy>

export class BackupError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message)
		this.name = "BackupError"
	}
}
