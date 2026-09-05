import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { dirname, join, posix } from "node:path"
import { z } from "zod"
import {
	assertNoLinks,
	confinedPath,
	isMissing,
	sha256File,
	walkFiles,
} from "./files.ts"
import { type BinaryRunner, resolveBinary, runBinary } from "./process.ts"
import {
	BackupError,
	type CommandOptions,
	type RecoveryManifest,
	type RecoveryMetadata,
	type RecoveryPoint,
	type Repository,
	type RetentionPolicy,
	recoveryHeader,
	recoveryManifest,
	recoveryMetadata,
	retentionPolicy,
	type SourceDifference,
} from "./types.ts"

const FORMAT_TAG = "hoardodile-format-1"
const PUBLISHED_TAG = "hoardodile-published"
const MANIFEST_PREFIX = "hoardodile-manifest:"
const METADATA_PREFIX = "hoardodile-metadata:"
const snapshotSchema = z.object({
	id: z.string().regex(/^[a-f0-9]{64}$/),
	tags: z.array(z.string()).default([]),
	summary: z
		.object({
			total_bytes_processed: z.number().optional(),
			data_added_packed: z.number().optional(),
			total_files_processed: z.number().optional(),
		})
		.optional(),
})
const nodeSchema = z.object({
	path: z.string(),
	type: z.string(),
	size: z.number().nonnegative().optional(),
})
const restoreEvent = z.object({
	message_type: z.literal("verbose_status"),
	action: z.string(),
	item: z.string(),
})

export type BackupEngine = ReturnType<typeof createBackupEngine>
export type RepairPlan = {
	id: string
	snapshotId: string
	files: Array<{ path: string; before: string | null }>
}

function encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url")
}
function decode(value: string): unknown {
	return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
}

export function createBackupEngine(options: {
	binary?: string
	run?: BinaryRunner
	cacheDir: string
}) {
	const binary = options.binary ?? resolveBinary({ name: "restic" })
	const run = options.run ?? runBinary

	async function command(
		repo: Repository,
		args: string[],
		context: CommandOptions = {},
		extra: {
			cwd?: string
			env?: NodeJS.ProcessEnv
			capture?: boolean
			onJson?: (value: unknown) => void
		} = {},
	) {
		return run({
			leaseDirectory: join(options.cacheDir, "..", "processes"),
			binary,
			args: ["--json", "--cache-dir", options.cacheDir, ...args],
			cwd: extra.cwd,
			env: {
				RESTIC_REPOSITORY: repo.path,
				RESTIC_PASSWORD_FILE: repo.passwordFile,
				...extra.env,
			},
			signal: context.signal,
			capture: extra.capture,
			onJson:
				extra.onJson || context.onProgress
					? (value) => {
							if (
								value &&
								typeof value === "object" &&
								"message_type" in value &&
								value.message_type === "error"
							) {
								throw new BackupError(
									"command_error",
									"The backup engine reported a data error",
								)
							}
							extra.onJson?.(value)
							context.onProgress?.(value)
						}
					: undefined,
		})
	}

	async function snapshots(repo: Repository) {
		const result = await command(repo, ["snapshots", "--tag", FORMAT_TAG])
		return z.array(snapshotSchema).parse(JSON.parse(result.stdout))
	}

	async function listRecoveryPoints(
		repo: Repository,
	): Promise<RecoveryPoint[]> {
		const result: RecoveryPoint[] = []
		for (const snapshot of await snapshots(repo)) {
			if (!snapshot.tags.includes(PUBLISHED_TAG)) continue
			const encodedManifest = snapshot.tags.find((tag) =>
				tag.startsWith(MANIFEST_PREFIX),
			)
			const encodedMetadata = snapshot.tags.find((tag) =>
				tag.startsWith(METADATA_PREFIX),
			)
			if (!encodedManifest || !encodedMetadata)
				throw new BackupError(
					"invalid_manifest",
					"A recovery point has invalid metadata",
				)
			const manifest = recoveryHeader.parse(
				decode(encodedManifest.slice(MANIFEST_PREFIX.length)),
			)
			const metadata = recoveryMetadata.parse(
				decode(encodedMetadata.slice(METADATA_PREFIX.length)),
			)
			result.push({
				...metadata,
				id: manifest.recoveryPointId,
				snapshotId: snapshot.id,
				createdAt: manifest.createdAt,
				manifest,
				totalBytes: snapshot.summary?.total_bytes_processed,
				newBytes: snapshot.summary?.data_added_packed,
				fileCount: snapshot.summary?.total_files_processed,
			})
		}
		const unique = new Map<string, RecoveryPoint>()
		for (const point of result) {
			const old = unique.get(point.id)
			if (!old || (point.revision ?? 0) > (old.revision ?? 0))
				unique.set(point.id, point)
		}
		return [...unique.values()].sort((a, b) => b.createdAt - a.createdAt)
	}

	async function point(repo: Repository, id: string): Promise<RecoveryPoint> {
		const match = (await listRecoveryPoints(repo)).find(
			(entry) => entry.id === id,
		)
		if (!match)
			throw new BackupError(
				"point_not_found",
				"The recovery point is unavailable",
			)
		return match
	}

	async function checkRepository(
		repo: Repository,
		context: CommandOptions & { readData?: boolean } = {},
	) {
		await command(
			repo,
			["check", ...(context.readData ? ["--read-data"] : [])],
			context,
			{ capture: false },
		)
	}

	async function readManifest(
		repo: Repository,
		id: string,
	): Promise<RecoveryManifest> {
		const selected = await point(repo, id)
		const manifestPath = posix.join(
			"/versions",
			posix.dirname(selected.manifest.databasePath),
			"recovery.json",
		)
		const result = await command(repo, [
			"dump",
			selected.snapshotId,
			manifestPath,
		])
		const { createHash } = await import("node:crypto")
		if (
			createHash("sha256").update(result.stdout).digest("hex") !==
			selected.manifest.manifestSha256
		) {
			throw new BackupError(
				"manifest_mismatch",
				"The recovery description does not match its snapshot",
			)
		}
		const manifest = recoveryManifest.parse(JSON.parse(result.stdout))
		if (manifest.recoveryPointId !== id)
			throw new BackupError(
				"manifest_mismatch",
				"The recovery point identity does not match",
			)
		return manifest
	}

	async function listFiles(
		repo: Repository,
		snapshotId: string,
		context: CommandOptions = {},
		onFile?: (path: string, size: number) => void,
	) {
		const files = new Set<string>()
		await command(repo, ["ls", snapshotId], context, {
			capture: false,
			onJson: (value) => {
				const parsed = nodeSchema.safeParse(value)
				if (!parsed.success) return
				const node = parsed.data
				if (node.type !== "file" && node.type !== "dir")
					throw new BackupError(
						"unsafe_snapshot",
						"The snapshot contains a link or special file",
					)
				const relative = node.path.replace(/^\//, "")
				if (relative === "versions" && node.type === "dir") return
				if (!relative.startsWith("versions/"))
					throw new BackupError(
						"unsafe_snapshot",
						"The snapshot contains files outside versions",
					)
				confinedPath("/snapshot", relative)
				if (node.type === "file") {
					const path = relative.slice("versions/".length)
					files.add(path)
					onFile?.(path, node.size ?? 0)
				}
			},
		})
		return files
	}

	async function compareSource(
		repo: Repository,
		input: { pointId: string; root: string } & CommandOptions,
	): Promise<SourceDifference[]> {
		const selected = await point(repo, input.pointId)
		const expected = await listFiles(repo, selected.snapshotId, input)
		const actual = new Set<string>()
		for await (const name of walkFiles(input.root)) actual.add(name)
		const differences: SourceDifference[] = []
		for (const path of expected)
			if (!actual.has(path)) differences.push({ path, status: "missing" })
		for (const path of actual)
			if (!expected.has(path)) differences.push({ path, status: "extra" })
		await command(
			repo,
			[
				"restore",
				`${selected.snapshotId}:/versions`,
				"--target",
				input.root,
				"--dry-run",
				"--overwrite",
				"always",
				"--verbose=2",
			],
			input,
			{
				capture: false,
				onJson: (value) => {
					const parsed = restoreEvent.safeParse(value)
					if (!parsed.success || parsed.data.action !== "updated") return
					const path = parsed.data.item.replace(/\\/g, "/").replace(/^\//, "")
					if (expected.has(path) && actual.has(path))
						differences.push({ path, status: "changed" })
				},
			},
		)
		return differences
	}

	async function restore(
		repo: Repository,
		input: {
			pointId: string
			target: string
			deleteExtra?: boolean
		} & CommandOptions,
	) {
		const selected = await point(repo, input.pointId)
		const manifest = await readManifest(repo, input.pointId)
		await listFiles(repo, selected.snapshotId, input)
		await mkdir(input.target, { recursive: true })
		for await (const _path of walkFiles(input.target)) {
			input.signal?.throwIfAborted()
		}
		await command(
			repo,
			[
				"restore",
				`${selected.snapshotId}:/versions`,
				"--target",
				input.target,
				"--overwrite",
				"always",
				"--verify",
				...(input.deleteExtra ? ["--delete", "--include", "/**"] : []),
			],
			input,
			{ capture: false },
		)
		const database = confinedPath(input.target, selected.manifest.databasePath)
		if ((await sha256File(database)) !== selected.manifest.databaseSha256) {
			throw new BackupError(
				"database_mismatch",
				"The restored database does not match its recovery point",
			)
		}
		return manifest
	}

	async function prepareRepair(
		repo: Repository,
		input: { pointId: string; root: string; paths: string[] } & CommandOptions,
	): Promise<RepairPlan> {
		const selected = await point(repo, input.pointId)
		const expected = await listFiles(repo, selected.snapshotId, input)
		const files: RepairPlan["files"] = []
		for (const path of new Set(input.paths)) {
			if (
				!expected.has(path) ||
				/\.(sqlite|sqlite-wal|sqlite-shm)$/i.test(path)
			) {
				throw new BackupError(
					"invalid_repair",
					"Only backed-up content files can be repaired individually",
				)
			}
			const full = confinedPath(input.root, path)
			await assertNoLinks(input.root, full)
			let before: string | null = null
			try {
				before = await sha256File(full)
			} catch (error) {
				if (!isMissing(error)) throw error
			}
			files.push({ path, before })
		}
		return { id: randomUUID(), snapshotId: selected.snapshotId, files }
	}

	async function repair(
		repo: Repository,
		input: { root: string; staging: string; plan: RepairPlan } & CommandOptions,
	) {
		const expected = await listFiles(repo, input.plan.snapshotId, input)
		await mkdir(input.staging, { recursive: true })
		for (const entry of input.plan.files) {
			input.signal?.throwIfAborted()
			if (!expected.has(entry.path))
				throw new BackupError(
					"invalid_repair",
					"The repair path is absent from the snapshot",
				)
			const target = confinedPath(input.root, entry.path)
			await assertNoLinks(input.root, target)
			let current: string | null = null
			try {
				current = await sha256File(target)
			} catch (error) {
				if (!isMissing(error)) throw error
			}
			if (current !== entry.before)
				throw new BackupError(
					"repair_conflict",
					"The file changed after the repair was prepared",
				)
			// Escape metacharacters so a selected filename never matches other files.
			const temporary = join(input.staging, randomUUID())
			await mkdir(temporary)
			try {
				await command(
					repo,
					[
						"restore",
						`${input.plan.snapshotId}:/versions`,
						"--target",
						temporary,
						"--include",
						escapePattern(`/${entry.path}`),
						"--verify",
					],
					input,
					{ capture: false },
				)
				const restored = confinedPath(temporary, entry.path)
				await stat(restored)
				await mkdir(dirname(target), { recursive: true })
				await rename(restored, target)
			} finally {
				await rm(temporary, { recursive: true, force: true })
			}
		}
	}

	function selectRetention(
		points: RecoveryPoint[],
		policy: RetentionPolicy,
		protectedIds: readonly string[],
	) {
		const groups = new Map<string, RecoveryPoint[]>()
		for (const point of points) {
			const group = groups.get(point.manifest.libraryId) ?? []
			group.push(point)
			groups.set(point.manifest.libraryId, group)
		}
		return [...groups.values()].flatMap((group) =>
			selectLibraryRetention(group, policy, protectedIds),
		)
	}

	function selectLibraryRetention(
		points: RecoveryPoint[],
		policy: RetentionPolicy,
		protectedIds: readonly string[],
	) {
		const keep = new Set(protectedIds)
		const latest = points[0]
		if (latest) keep.add(latest.id)
		const threshold =
			(latest?.createdAt ?? Date.now()) - policy.withinHours * 3600_000
		for (const entry of points)
			if (
				entry.kind === "manual" ||
				entry.pinned ||
				entry.createdAt >= threshold
			)
				keep.add(entry.id)
		for (const [limit, period] of [
			[policy.daily, "day"],
			[policy.weekly, "week"],
			[policy.monthly, "month"],
		] as const) {
			const buckets = new Set<string>()
			for (const entry of points) {
				const date = new Date(entry.createdAt)
				const key =
					period === "month"
						? `${date.getUTCFullYear()}-${date.getUTCMonth()}`
						: String(
								Math.floor(
									(entry.createdAt + (period === "week" ? 3 * 86400_000 : 0)) /
										(period === "week" ? 7 * 86400_000 : 86400_000),
								),
							)
				if (buckets.has(key)) continue
				if (buckets.size >= limit) break
				buckets.add(key)
				keep.add(entry.id)
			}
		}
		return points.filter((entry) => !keep.has(entry.id))
	}

	return {
		async capabilities() {
			const result = await run({ binary, args: ["version"] })
			if (!/restic 0\.19\./.test(result.stdout))
				throw new BackupError("unsupported_binary", "Restic 0.19 is required")
			return { version: result.stdout.trim() }
		},
		async initializeRepository(
			repo: Repository,
			context: CommandOptions & { source?: Repository } = {},
		) {
			await mkdir(repo.path, { recursive: true })
			const args = ["init", "--repository-version", "2"]
			if (context.source) args.push("--copy-chunker-params")
			await command(repo, args, context, {
				env: context.source
					? {
							RESTIC_FROM_REPOSITORY: context.source.path,
							RESTIC_FROM_PASSWORD_FILE: context.source.passwordFile,
						}
					: undefined,
			})
		},
		listRecoveryPoints,
		checkRepository,
		compareSource,
		restore,
		prepareRepair,
		repair,
		listFiles,
		async restoreSample(
			repo: Repository,
			input: { pointId: string; target: string } & CommandOptions,
		) {
			const selected = await point(repo, input.pointId)
			const manifest = await readManifest(repo, input.pointId)
			let sample: { path: string; size: number } | undefined
			const files = await listFiles(
				repo,
				selected.snapshotId,
				input,
				(path, size) => {
					if (
						/^[1-9][0-9]*\/resources\/[^/]+\/data\//.test(path) &&
						(!sample || size < sample.size)
					)
						sample = { path, size }
				},
			)
			await mkdir(input.target, { recursive: true })
			await command(
				repo,
				[
					"restore",
					`${selected.snapshotId}:/versions`,
					"--target",
					input.target,
					"--verify",
					"--include",
					escapePattern(`/${manifest.databasePath}`),
					"--include",
					"/*/app.sqlite",
					"--include",
					"/*/plugins/*/manifest.json",
					"--include",
					"/*/plugins/*/main.js",
					"--include",
					"/*/plugins/*/render.js",
					...(sample ? ["--include", escapePattern(`/${sample.path}`)] : []),
				],
				input,
				{ capture: false },
			)
			if (
				(await sha256File(
					confinedPath(input.target, manifest.databasePath),
				)) !== manifest.databaseSha256
			)
				throw new BackupError(
					"database_mismatch",
					"The restored checkpoint failed verification",
				)
			return { manifest, files, sampledResource: sample?.path ?? null }
		},
		async deleteRecoveryPoint(
			repo: Repository,
			id: string,
			protectedIds: readonly string[] = [],
		) {
			const all = await listRecoveryPoints(repo)
			const selected = all.find((entry) => entry.id === id)
			if (!selected)
				throw new BackupError(
					"point_not_found",
					"The recovery point is unavailable",
				)
			if (all.length <= 1 || protectedIds.includes(id))
				throw new BackupError(
					"protected_point",
					"The last complete or currently used recovery point cannot be removed",
				)
			await command(repo, ["forget", selected.snapshotId])
		},
		async extractDatabase(
			repo: Repository,
			input: {
				pointId: string
				target: string
				includeHistory?: boolean
			} & CommandOptions,
		) {
			const selected = await point(repo, input.pointId)
			const manifest = await readManifest(repo, input.pointId)
			await mkdir(input.target, { recursive: true })
			await command(
				repo,
				[
					"restore",
					`${selected.snapshotId}:/versions`,
					"--target",
					input.target,
					"--include",
					escapePattern(`/${manifest.databasePath}`),
					...(input.includeHistory
						? [
								"--include",
								"/*/plugins/*/manifest.json",
								"--include",
								"/*/app.sqlite",
							]
						: []),
					"--verify",
				],
				input,
				{ capture: false },
			)
			const path = confinedPath(input.target, manifest.databasePath)
			if ((await sha256File(path)) !== manifest.databaseSha256)
				throw new BackupError(
					"database_mismatch",
					"The database checkpoint failed verification",
				)
			return { path, manifest }
		},
		async createBackup(
			repo: Repository,
			input: {
				storageRoot: string
				manifest: RecoveryManifest
				metadata: RecoveryMetadata
			} & CommandOptions,
		): Promise<RecoveryPoint> {
			const manifest = recoveryManifest.parse(input.manifest)
			const metadata = recoveryMetadata.parse(input.metadata)
			const root = join(input.storageRoot, "versions")
			for await (const _path of walkFiles(root)) {
				input.signal?.throwIfAborted()
			}
			const database = confinedPath(root, manifest.databasePath)
			if ((await sha256File(database)) !== manifest.databaseSha256)
				throw new BackupError(
					"database_mismatch",
					"The checkpoint database changed",
				)
			const descriptionPath = join(dirname(database), "recovery.json")
			const recorded = recoveryManifest.parse(
				JSON.parse(await readFile(descriptionPath, "utf8")),
			)
			if (JSON.stringify(recorded) !== JSON.stringify(manifest))
				throw new BackupError(
					"manifest_mismatch",
					"The checkpoint description changed",
				)
			const { plugins, ...summary } = manifest
			const header = recoveryHeader.parse({
				...summary,
				pluginCount: plugins.length,
				manifestSha256: await sha256File(descriptionPath),
			})
			const previous = (await listRecoveryPoints(repo)).find(
				(entry) => entry.manifest.libraryId === manifest.libraryId,
			)
			let createdSnapshot: string | undefined
			await command(
				repo,
				[
					"backup",
					"--no-scan",
					"--host",
					manifest.instanceId,
					"--tag",
					FORMAT_TAG,
					"--tag",
					MANIFEST_PREFIX + encode(header),
					"--tag",
					METADATA_PREFIX + encode(metadata),
					...(previous ? ["--parent", previous.snapshotId] : []),
					"versions",
				],
				input,
				{
					cwd: input.storageRoot,
					capture: false,
					onJson: (value) => {
						const summary = z
							.object({
								message_type: z.literal("summary"),
								snapshot_id: z.string().regex(/^[a-f0-9]{64}$/),
							})
							.safeParse(value)
						if (summary.success) createdSnapshot = summary.data.snapshot_id
					},
				},
			)
			if (!createdSnapshot)
				throw new BackupError(
					"incomplete_backup",
					"The backup did not produce a snapshot",
				)
			await checkRepository(repo, input)
			await command(repo, ["tag", "--add", PUBLISHED_TAG, createdSnapshot], {
				signal: input.signal,
			})
			return point(repo, manifest.recoveryPointId)
		},
		async updateMetadata(
			repo: Repository,
			id: string,
			metadata: RecoveryMetadata,
		) {
			const selected = await point(repo, id)
			const tags =
				(await snapshots(repo)).find(
					(entry) => entry.id === selected.snapshotId,
				)?.tags ?? []
			const old = tags.find((tag) => tag.startsWith(METADATA_PREFIX))
			await command(repo, [
				"tag",
				...(old ? ["--remove", old] : []),
				"--add",
				METADATA_PREFIX +
					encode(
						recoveryMetadata.parse({
							...metadata,
							kind: selected.kind,
							revision: (selected.revision ?? 0) + 1,
						}),
					),
				selected.snapshotId,
			])
			return point(repo, id)
		},
		async previewRetention(
			repo: Repository,
			policy: RetentionPolicy,
			protectedIds: readonly string[] = [],
		) {
			return selectRetention(
				await listRecoveryPoints(repo),
				retentionPolicy.parse(policy),
				protectedIds,
			)
		},
		async applyRetention(
			repo: Repository,
			input: {
				policy: RetentionPolicy
				protectedIds?: readonly string[]
			} & CommandOptions,
		) {
			const expired = selectRetention(
				await listRecoveryPoints(repo),
				retentionPolicy.parse(input.policy),
				input.protectedIds ?? [],
			)
			for (const entry of expired)
				await command(repo, ["forget", entry.snapshotId], input)
			return expired.map((entry) => entry.id)
		},
		async prune(repo: Repository, context: CommandOptions = {}) {
			await command(repo, ["prune"], context, { capture: false })
			await checkRepository(repo, context)
		},
		async copy(
			repo: Repository,
			input: { source: Repository; snapshotId: string } & CommandOptions,
		) {
			snapshotSchema.shape.id.parse(input.snapshotId)
			await command(repo, ["copy", input.snapshotId], input, {
				capture: false,
				env: {
					RESTIC_FROM_REPOSITORY: input.source.path,
					RESTIC_FROM_PASSWORD_FILE: input.source.passwordFile,
				},
			})
			await checkRepository(repo, input)
		},
		readManifest,
		async readRecoveryKey(repo: Repository) {
			return (await readFile(repo.passwordFile, "utf8")).trim()
		},
	}
}

function escapePattern(path: string): string {
	return path.replace(/[\\*?[\]]/g, "\\$&")
}
