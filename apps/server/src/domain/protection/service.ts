import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	statfs,
} from "node:fs/promises"
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path"
import {
	atomicWrite,
	type BackupEngine,
	BackupError,
	confinedPath,
	createBackupEngine,
	createJobManager,
	createRepositoryLocks,
	isMissing,
	type JobContext,
	type JobHandler,
	type RecoveryManifest,
	type RecoveryPoint,
	type Repository,
	readJsonState,
	recoveryMetadata,
	retentionPolicy,
} from "@hoardodile/backup"
import { type StoragePaths, storageCoordinator } from "@hoardodile/host/hoard"
import { catalogFor } from "@hoardodile/i18n/catalogs"
import type { SupportedLanguage } from "@hoardodile/i18n/core"
import { prepareCheckpoint } from "src/infra/storage/checkpoint.ts"
import { z } from "zod"
import {
	backupPassword,
	createDesktopRepositories,
	physicalPath as repositoryPhysicalPath,
} from "./desktop-repositories.ts"
import { autoBackupIntervalHours } from "./schedule.ts"

const repositoryId = z.union([z.literal("local"), z.uuid()])
const stateSchema = z.object({
	instanceId: z.uuid(),
	libraryId: z.uuid(),
	enabled: z.boolean(),
	autoBackupIntervalHours,
	policy: retentionPolicy,
	repositories: z.array(
		z.object({
			id: repositoryId,
			name: z.string(),
			sourceInstanceId: z.uuid().optional(),
			lastContentCheckAt: z.number().optional(),
			lastAddedAt: z.number().optional(),
			lastRetentionAt: z.number().optional(),
			lastPruneAt: z.number().optional(),
		}),
	),
	lastBackupAt: z.number().nullable(),
	lastAutoBackupAt: z.number().nullable().default(null),
	lastContentCheckAt: z.number().nullable(),
	activeBackupId: z.uuid().optional(),
})
const restorePlanSchema = z.object({
	id: z.uuid(),
	instanceId: z.uuid(),
	repositoryId,
	pointId: z.uuid(),
	snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
	root: z.string(),
	createdAt: z.number(),
	confirmationPhrase: z.string().default("RESTORE"),
	source: z
		.object({
			path: z.string(),
			passwordFile: z.string(),
			identity: z.string(),
		})
		.optional(),
})
export const maintenanceRecord = restorePlanSchema.extend({
	phase: z.enum(["restoring", "installing", "reloading"]),
})
export type MaintenanceRecord = z.infer<typeof maintenanceRecord>

export function protectionDirectory(root: string) {
	return join(root, "local", "protection")
}

export type ProtectionService = Awaited<
	ReturnType<typeof createProtectionService>
>
export type ProtectionDependencies = {
	paths: () => StoragePaths
	backupRoot: string
	desktop?: boolean
	drillRoot?: string
	appVersion: string
	minFreeBytes: number
	engine?: BackupEngine
	assertArchivable: () => void
	enterMaintenance: () => Promise<void>
	installDatabase: (manifest: RecoveryManifest) => Promise<void>
	validateDatabase: (path: string) => Promise<void>
	validateRecovery?: (input: {
		metadataRoot: string
		manifest: RecoveryManifest
		files: ReadonlySet<string>
	}) => Promise<void>
	reloadLibrary: () => Promise<void>
	leaveMaintenance: () => void
	isMaintenance?: () => boolean
	contextBusy?: () => boolean
	hasOrphans?: () => boolean
	onError?: (error: unknown) => void
}

export async function createProtectionService(deps: ProtectionDependencies) {
	const root = resolve(deps.paths().root)
	const local = protectionDirectory(root)
	const backupRoot = resolve(deps.backupRoot)
	const versionsRoot = join(root, "versions")
	async function physicalPath(path: string): Promise<string> {
		let current = path
		const suffix: string[] = []
		for (;;) {
			try {
				return resolve(await realpath(current), ...suffix)
			} catch (error) {
				if (!isMissing(error) || dirname(current) === current) throw error
				suffix.unshift(basename(current))
				current = dirname(current)
			}
		}
	}
	const overlaps = (parent: string, child: string) => {
		const value = relative(parent, child)
		return (
			value === "" ||
			(!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`))
		)
	}
	const [physicalVersions, physicalBackups] = await Promise.all([
		physicalPath(versionsRoot),
		physicalPath(backupRoot),
	])
	if (
		overlaps(physicalVersions, physicalBackups) ||
		overlaps(physicalBackups, physicalVersions)
	)
		throw new Error("The backup root must not overlap versions")
	await mkdir(local, { recursive: true })
	const drillTargets: { id: "local" | "external"; path: string }[] = [
		{ id: "local", path: join(local, "drills") },
	]
	if (deps.drillRoot)
		drillTargets.push({ id: "external", path: resolve(deps.drillRoot) })
	async function validateDrillTarget(path: string) {
		const target = await physicalPath(path)
		const protectedPaths = [
			physicalVersions,
			await physicalPath(join(backupRoot, "local")),
			await physicalPath(join(backupRoot, "sources")),
		]
		if (
			protectedPaths.some(
				(protectedPath) =>
					overlaps(target, protectedPath) || overlaps(protectedPath, target),
			)
		)
			throw new BackupError(
				"invalid_drill_target",
				"The recovery drill folder must be separate from versions and backup repositories",
			)
	}
	for (const target of drillTargets) await validateDrillTarget(target.path)
	const statePath = join(local, "state.json")
	const state = await readJsonState(statePath, stateSchema, () => ({
		instanceId: randomUUID(),
		libraryId: randomUUID(),
		enabled: false,
		autoBackupIntervalHours: autoBackupIntervalHours.parse(undefined),
		policy: retentionPolicy.parse({}),
		repositories: [],
		lastBackupAt: null,
		lastAutoBackupAt: null,
		lastContentCheckAt: null,
	}))
	await atomicWrite(statePath, JSON.stringify(state))
	let stateWrites: Promise<void> = Promise.resolve()
	const persist = () => {
		const content = JSON.stringify(state)
		stateWrites = stateWrites
			.catch(() => {})
			.then(() => atomicWrite(statePath, content))
		return stateWrites
	}
	const engine =
		deps.engine ?? createBackupEngine({ cacheDir: join(local, "cache") })
	const locations = await createDesktopRepositories({
		directory: local,
		storageRoot: root,
		protectedPaths: [
			versionsRoot,
			join(root, "local"),
			...drillTargets.map((target) => target.path),
		],
		engine,
	})
	const repositoryLocks = createRepositoryLocks()
	const lockPath = (path: string) =>
		process.platform === "win32" ? path.toLowerCase() : path
	const lockKey = (id: string) => {
		const path =
			id === "local"
				? (locations.active()?.path ?? join(backupRoot, "local"))
				: (locations.get(id)?.path ?? join(backupRoot, "sources", id))
		return lockPath(path)
	}
	const locks = {
		run<T>(id: string, operation: () => Promise<T>) {
			return repositoryLocks.run(lockKey(id), operation)
		},
		busy: (id: string) => repositoryLocks.busy(lockKey(id)),
	}
	let destinationChanging = false
	let backupAvailable: boolean | null = null
	const catalogs = new Map<string, { at: number; points: RecoveryPoint[] }>()
	const catalogLoads = new Map<string, Promise<RecoveryPoint[]>>()
	async function listPoints(id: string): Promise<RecoveryPoint[]> {
		if (destinationChanging)
			throw new BackupError("storage_busy", "The backup location is changing")
		const cached = catalogs.get(id)
		if (cached && (Date.now() - cached.at < 5000 || locks.busy(id)))
			return cached.points
		const existing = catalogLoads.get(id)
		if (existing) return existing
		const request = checkedRepository(id)
			.then((repo) => engine.listRecoveryPoints(repo))
			.then((points) => {
				if (id === "local") backupAvailable = true
				catalogs.set(id, { at: Date.now(), points })
				return points
			})
		catalogLoads.set(id, request)
		try {
			return await request
		} finally {
			catalogLoads.delete(id)
		}
	}
	const coordinator = storageCoordinator(root)
	let maintenance: MaintenanceRecord | null = null
	let maintenanceError: string | null = null
	try {
		maintenance = await readJsonState(
			join(local, "maintenance.json"),
			maintenanceRecord.nullable(),
			() => null,
		)
	} catch {
		maintenanceError =
			"The restore journal is damaged; select a complete recovery point to recover the library"
	}
	const handlers: Record<string, JobHandler> = {}
	let lastRestore = await readJsonState(
		join(local, "last-restore.json"),
		z
			.object({ pointId: z.uuid(), repositoryId, restoredAt: z.number() })
			.nullable(),
		() => null,
	).catch((error: unknown) => {
		deps.onError?.(error)
		return null
	})
	const fileRequests = new Map<
		string,
		{ cancel: () => void; finished: Promise<boolean> }
	>()
	handlers["file-write"] = async (input, context) => {
		const { requestId } = z.object({ requestId: z.string() }).parse(input)
		const request = fileRequests.get(requestId)
		if (!request)
			throw new BackupError(
				"resubmit_request",
				"Submit the original file operation again; its connection ended",
			)
		const cancel = () => request.cancel()
		context.signal.addEventListener("abort", cancel, { once: true })
		try {
			if (context.signal.aborted) cancel()
			context.progress({ phase: "waiting-for-storage" })
			if (!(await request.finished))
				throw new BackupError(
					context.signal.aborted ? "cancelled" : "request_ended",
					"The file operation ended without a successful response; submit it again if needed",
				)
			return { completed: true }
		} finally {
			context.signal.removeEventListener("abort", cancel)
			fileRequests.delete(requestId)
		}
	}
	const sourceInput = z.object({ repositoryId, pointId: z.uuid() })
	function repository(id: string): Repository {
		repositoryId.parse(id)
		const registered = id === "local" ? locations.active() : locations.get(id)
		if (registered) return { ...registered, id }
		if (!state.repositories.some((entry) => entry.id === id))
			throw new BackupError(
				"repository_not_found",
				"The repository is not configured",
			)
		return {
			id,
			path:
				id === "local"
					? join(backupRoot, "local")
					: join(backupRoot, "sources", id),
			passwordFile: join(local, "keys", id),
		}
	}
	async function checkedRepository(id: string): Promise<Repository> {
		const repo = repository(id)
		try {
			await locations.identity(
				repo,
				id === "local"
					? locations.activeIdentity()
					: locations.expectedIdentity(id),
			)
			if (id === "local") backupAvailable = true
			return repo
		} catch (error) {
			if (id === "local") backupAvailable = false
			throw error
		}
	}
	function mutableRepository(id: string): Repository {
		if (destinationChanging)
			throw new BackupError("storage_busy", "The backup location is changing")
		if (locations.sources().some((entry) => entry.id === id))
			throw new BackupError(
				"restore_only",
				"This folder is only available as a restore source",
			)
		return repository(id)
	}
	const commandContext = (context: JobContext) => ({
		signal: context.signal,
		onProgress: context.progress,
	})
	const writable = () => {
		if (destinationChanging)
			throw new BackupError("storage_busy", "The backup location is changing")
		if (maintenance || maintenanceError || deps.isMaintenance?.())
			throw new BackupError("maintenance", "The library is in maintenance mode")
	}
	async function checkSpace() {
		const disk = await statfs(root)
		if (disk.bavail * disk.bsize < deps.minFreeBytes)
			throw new BackupError(
				"low_disk",
				"There is insufficient free space for this operation",
			)
	}
	async function writeMaintenance(record: MaintenanceRecord) {
		await atomicWrite(join(local, "maintenance.json"), JSON.stringify(record))
		maintenance = record
		maintenanceError = null
	}
	handlers.backup = async (raw, context) => {
		writable()
		const input = recoveryMetadata.parse(raw)
		return locks.run("local", () =>
			coordinator.freeze({
				signal: context.signal,
				operation: async () => {
					writable()
					await checkSpace()
					deps.assertArchivable()
					context.progress({ phase: "checkpoint" })
					const manifest = await prepareCheckpoint({
						paths: deps.paths(),
						instanceId: state.instanceId,
						libraryId: state.libraryId,
						appVersion: deps.appVersion,
						signal: context.signal,
					})
					context.progress({ phase: "backup" })
					const point = await engine.createBackup(
						await checkedRepository("local"),
						{
							storageRoot: root,
							manifest,
							metadata: input,
							...commandContext(context),
						},
					)
					state.lastBackupAt = manifest.createdAt
					if (input.kind === "auto") state.lastAutoBackupAt = manifest.createdAt
					const localRepository = state.repositories.find(
						(entry) => entry.id === "local",
					)
					if (localRepository) {
						localRepository.lastAddedAt = Date.now()
						localRepository.lastPruneAt ??= Date.now()
					}
					catalogs.delete("local")
					await persist()
					return point
				},
			}),
		)
	}
	handlers.check = async (raw, context) => {
		const input = z
			.object({ repositoryId, readData: z.boolean().default(false) })
			.parse(raw)
		return locks.run(input.repositoryId, async () => {
			await engine.checkRepository(mutableRepository(input.repositoryId), {
				readData: input.readData,
				...commandContext(context),
			})
			if (input.readData) {
				state.lastContentCheckAt = Date.now()
				const entry = state.repositories.find(
					(repo) => repo.id === input.repositoryId,
				)
				if (entry) entry.lastContentCheckAt = state.lastContentCheckAt
				await persist()
			}
			return { ok: true, readData: input.readData }
		})
	}
	handlers.compare = async (raw, context) => {
		writable()
		const input = sourceInput.parse(raw)
		return locks.run(input.repositoryId, () =>
			coordinator.freeze({
				signal: context.signal,
				operation: () =>
					engine.compareSource(mutableRepository(input.repositoryId), {
						pointId: input.pointId,
						root: versionsRoot,
						...commandContext(context),
					}),
			}),
		)
	}
	handlers.repair = async (raw, context) => {
		writable()
		const input = z.object({ repositoryId, planId: z.uuid() }).parse(raw)
		mutableRepository(input.repositoryId)
		const saved = await readFile(
			join(local, "repairs", `${input.planId}.json`),
			"utf8",
		)
		const plan = z
			.object({
				repositoryId,
				libraryId: z.uuid(),
				id: z.uuid(),
				snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
				files: z.array(
					z.object({ path: z.string(), before: z.string().nullable() }),
				),
			})
			.parse(JSON.parse(saved))
		return locks.run(input.repositoryId, () =>
			coordinator.freeze({
				signal: context.signal,
				operation: async () => {
					writable()
					if (
						plan.repositoryId !== input.repositoryId ||
						plan.libraryId !== state.libraryId
					)
						throw new BackupError(
							"repair_scope_changed",
							"Prepare the file repair again for this library and repository",
						)
					await engine.repair(repository(input.repositoryId), {
						root: versionsRoot,
						staging: join(local, "repair-staging"),
						plan,
						...commandContext(context),
					})
					await rm(join(local, "repairs", `${input.planId}.json`), {
						force: true,
					})
					return { repaired: plan.files.length }
				},
			}),
		)
	}
	handlers.restore = async (raw, context) => {
		const input = z.object({ planId: z.uuid() }).parse(raw)
		const plan = restorePlanSchema.parse(
			JSON.parse(
				await readFile(join(local, "restores", `${input.planId}.json`), "utf8"),
			),
		)
		if (plan.instanceId !== state.instanceId || plan.root !== root)
			throw new BackupError(
				"restore_target_changed",
				"The restore target changed",
			)
		if (!maintenance && Date.now() - plan.createdAt > 15 * 60_000)
			throw new BackupError("restore_plan_expired", "Prepare the restore again")
		if (maintenance && maintenance.id !== plan.id)
			throw new BackupError("maintenance", "Another restore is in progress")
		return repositoryLocks.run(
			plan.source ? lockPath(plan.source.path) : lockKey(plan.repositoryId),
			() =>
				coordinator.freeze({
					signal: context.signal,
					operation: async () => {
						const repo = plan.source
							? { id: plan.repositoryId, ...plan.source }
							: await checkedRepository(plan.repositoryId)
						if (plan.source)
							await locations.identity(repo, plan.source.identity)
						const point = (await engine.listRecoveryPoints(repo)).find(
							(entry) => entry.id === plan.pointId,
						)
						if (!point || point.snapshotId !== plan.snapshotId)
							throw new BackupError(
								"restore_source_changed",
								"Prepare the restore again because its source changed",
							)
						await checkSpace()
						await writeMaintenance({ ...plan, phase: "restoring" })
						await deps.enterMaintenance()
						const manifest = await engine.restore(repo, {
							pointId: plan.pointId,
							target: versionsRoot,
							deleteExtra: true,
							...commandContext(context),
						})
						await writeMaintenance({ ...plan, phase: "installing" })
						await deps.installDatabase(manifest)
						state.libraryId = manifest.libraryId
						await persist()
						await writeMaintenance({ ...plan, phase: "reloading" })
						await deps.reloadLibrary()
						lastRestore = {
							pointId: plan.pointId,
							repositoryId: plan.repositoryId,
							restoredAt: Date.now(),
						}
						await atomicWrite(
							join(local, "last-restore.json"),
							JSON.stringify(lastRestore),
						)
						await rm(join(local, "maintenance.json"), { force: true })
						maintenance = null
						deps.leaveMaintenance()
						await locations
							.release(plan.repositoryId)
							.catch((error) => deps.onError?.(error))
						catalogs.delete(plan.repositoryId)
						return { pointId: plan.pointId }
					},
				}),
		)
	}
	handlers.retention = async (raw, context) => {
		const input = z
			.object({ repositoryId, prune: z.boolean().default(false) })
			.parse(raw)
		mutableRepository(input.repositoryId)
		return locks.run(input.repositoryId, async () => {
			const removed = await engine.applyRetention(
				repository(input.repositoryId),
				{
					policy: state.policy,
					protectedIds:
						maintenance?.repositoryId === input.repositoryId
							? [maintenance.pointId]
							: [],
					...commandContext(context),
				},
			)
			const record = state.repositories.find(
				(entry) => entry.id === input.repositoryId,
			)
			if (record) record.lastRetentionAt = Date.now()
			catalogs.delete(input.repositoryId)
			await persist()
			if (input.prune)
				await engine.prune(
					repository(input.repositoryId),
					commandContext(context),
				)
			if (input.prune && record) {
				record.lastPruneAt = Date.now()
				await persist()
			}
			return { removed }
		})
	}
	handlers.drill = async (raw, context) => {
		const input = sourceInput
			.extend({
				full: z.boolean(),
				targetId: z.enum(["local", "external"]).default("local"),
			})
			.parse(raw)
		return locks.run(input.repositoryId, async () => {
			const repo = mutableRepository(input.repositoryId)
			const point = (await engine.listRecoveryPoints(repo)).find(
				(entry) => entry.id === input.pointId,
			)
			if (!point)
				throw new BackupError(
					"point_not_found",
					"The recovery point is unavailable",
				)
			const location = drillTargets.find((entry) => entry.id === input.targetId)
			if (!location)
				throw new BackupError(
					"unknown_drill_target",
					"This recovery drill folder is no longer configured",
				)
			await validateDrillTarget(location.path)
			await mkdir(location.path, { recursive: true })
			const target = join(location.path, context.jobId)
			await mkdir(target)
			try {
				const disk = await statfs(target)
				if (
					input.full &&
					(point.totalBytes === undefined ||
						disk.bavail * disk.bsize < point.totalBytes + deps.minFreeBytes)
				)
					throw new BackupError(
						"low_disk",
						"A full recovery drill requires enough free space for a complete temporary copy",
					)
				let manifest: RecoveryManifest
				let files: ReadonlySet<string>
				if (input.full) {
					manifest = await engine.restore(repo, {
						pointId: input.pointId,
						target,
						...commandContext(context),
					})
					files = await engine.listFiles(repo, point.snapshotId)
				} else {
					const result = await engine.restoreSample(repo, {
						pointId: input.pointId,
						target,
						...commandContext(context),
					})
					manifest = result.manifest
					files = result.files
				}
				await deps.validateDatabase(confinedPath(target, manifest.databasePath))
				await deps.validateRecovery?.({ metadataRoot: target, manifest, files })
				return {
					verified: true,
					mode: input.full ? "full" : "sample",
					pointId: input.pointId,
					targetId: location.id,
				}
			} finally {
				await rm(target, { recursive: true, force: true })
			}
		})
	}
	const jobs = await createJobManager({
		directory: join(local, "jobs"),
		handlers,
		onError: deps.onError,
	})
	async function cleanupInterruptedDrills() {
		if (deps.hasOrphans?.()) return
		await locations.cleanupCandidates()
		for (const location of drillTargets) {
			const directory = location.path
			const entries = await readdir(directory).catch((error: unknown) => {
				if (isMissing(error)) return []
				throw error
			})
			for (const id of entries) {
				if (!z.uuid().safeParse(id).success) continue
				const job = jobs.get(id)
				if (job?.kind !== "drill") continue
				if (["queued", "running", "cancelling"].includes(job.state)) continue
				await rm(join(directory, id), { recursive: true, force: true })
			}
		}
	}
	await cleanupInterruptedDrills()
	for (const source of locations.sources())
		if (maintenance?.repositoryId !== source.id)
			await locations.release(source.id)
	function applyDestinationStats(points: RecoveryPoint[], activeId: string) {
		const libraryPoints = points
			.filter((point) => point.manifest.libraryId === state.libraryId)
			.sort((a, b) => b.createdAt - a.createdAt)
		const wasConfigured = state.repositories.some(
			(entry) => entry.id === "local",
		)
		state.repositories = [
			...state.repositories.filter((entry) => entry.id !== "local"),
			{
				id: "local",
				name: "Local backups",
				lastAddedAt: libraryPoints[0]?.createdAt,
			},
		]
		state.lastBackupAt = libraryPoints[0]?.createdAt ?? null
		state.lastAutoBackupAt =
			libraryPoints.find((point) => point.kind === "auto")?.createdAt ?? null
		state.lastContentCheckAt = null
		state.activeBackupId = activeId
		if (!wasConfigured) state.enabled = true
	}
	const activeDestination = locations.active()
	if (activeDestination && state.activeBackupId !== activeDestination.id) {
		const points = await engine
			.listRecoveryPoints(activeDestination)
			.catch((error) => {
				deps.onError?.(error)
				backupAvailable = false
				return []
			})
		applyDestinationStats(points, activeDestination.id)
		await persist()
	}
	async function setBackupLocation(input: {
		selectionId: string
		credential?: string
		credentialType?: "password" | "key"
		password?: string
	}) {
		writable()
		if (!deps.desktop)
			throw new BackupError(
				"desktop_only",
				"Choose backup folders in the desktop application",
			)
		if (
			deps.contextBusy?.() ||
			deps.hasOrphans?.() ||
			coordinator.state().frozen ||
			locks.busy("local") ||
			catalogLoads.size ||
			jobs
				.list()
				.some((job) => ["queued", "running", "cancelling"].includes(job.state))
		)
			throw new BackupError(
				"storage_busy",
				"Finish or cancel current storage operations before changing the backup location",
			)
		destinationChanging = true
		const previousActive = locations.active()?.id ?? null
		const previousState = structuredClone(state)
		try {
			const connected = await locations.connect({ ...input, purpose: "backup" })
			const points = await engine.listRecoveryPoints(
				locations.descriptor(connected.entry),
			)
			applyDestinationStats(points, connected.entry.id)
			await locations.activate(connected.entry.id)
			await persist()
			catalogs.clear()
			backupAvailable = true
			destinationChanging = false
			return connected.created
				? jobs.start("backup", {
						name: "",
						note: "",
						kind: "manual",
						pinned: true,
					})
				: null
		} catch (error) {
			Object.assign(state, previousState)
			await locations.activate(previousActive)
			await persist()
			throw error
		} finally {
			destinationChanging = false
		}
	}
	return {
		jobs,
		cleanupInterruptedDrills,
		async observeFileRequest(input: {
			requestId: string
			cancel: () => void
			finished: Promise<boolean>
		}) {
			if (fileRequests.has(input.requestId)) return
			fileRequests.set(input.requestId, input)
			try {
				await jobs.start("file-write", { requestId: input.requestId })
			} catch (error) {
				fileRequests.delete(input.requestId)
				throw error
			}
		},
		engine,
		locks,
		repository,
		getStatus: () => ({
			...state,
			repositories: [
				...state.repositories.map((entry) => ({
					...entry,
					path: repository(entry.id).path,
					restoreOnly: false,
				})),
				...locations.sources(),
			],
			maintenance,
			maintenanceError,
			lastRestore,
			drillTargets,
			storage: coordinator.state(),
			backupRoot: locations.active()?.path ?? backupRoot,
			backupAvailable,
			localRepositoryPath:
				locations.active()?.path ?? join(backupRoot, "local"),
			storageRoot: root,
		}),
		registerFolder: (path: string, purpose: "restore" | "backup") =>
			locations.select(path, purpose),
		setBackupLocation,
		async openRestoreSource(input: {
			selectionId: string
			credential: string
			credentialType?: "password" | "key"
		}) {
			if (!deps.desktop)
				throw new BackupError(
					"desktop_only",
					"Choose backup folders in the desktop application",
				)
			const connected = await locations.connect({
				...input,
				purpose: "restore",
			})
			try {
				const points = await engine.listRecoveryPoints(
					locations.descriptor(connected.entry),
				)
				if (!points.length)
					throw new BackupError(
						"no_recovery_points",
						"This folder has no complete recovery points",
					)
				catalogs.set(connected.entry.id, { at: Date.now(), points })
			} catch (error) {
				await locations.release(connected.entry.id)
				throw error
			}
			return { repositoryId: connected.entry.id }
		},
		async closeRestoreSource(id: string) {
			if (
				maintenance?.repositoryId === id ||
				jobs
					.list()
					.some(
						(job) =>
							job.kind === "restore" &&
							["queued", "running", "cancelling"].includes(job.state),
					)
			)
				return
			await locations.release(id)
			catalogs.delete(id)
		},
		async initialize(recoveryKey?: string, password?: string) {
			writable()
			if (deps.desktop && !recoveryKey) {
				backupPassword.parse(password)
				const selection = await locations.selectDefault(
					locations.active()?.path ?? join(backupRoot, "local"),
				)
				if (selection.exists)
					throw new BackupError(
						"recovery_key_required",
						"Open the existing backup with its password or recovery key",
					)
				return setBackupLocation({ selectionId: selection.id, password })
			}
			if (recoveryKey?.trim().startsWith("{")) {
				recoveryKey = z
					.object({
						key: z.string().min(1),
						format: z.literal("hoardodile-restic-v1"),
					})
					.parse(JSON.parse(recoveryKey)).key
			}
			let created = false
			await locks.run("local", async () => {
				await engine.capabilities()
				const passwordFile = join(local, "keys", "local")
				let exists = false
				try {
					await stat(join(backupRoot, "local", "config"))
					exists = true
				} catch (error) {
					if (!isMissing(error)) throw error
				}
				if (exists && !recoveryKey && !state.enabled)
					throw new BackupError(
						"recovery_key_required",
						"Enter the recovery key for the existing repository",
					)
				if (!exists && recoveryKey)
					throw new BackupError(
						"repository_not_found",
						"No existing backup repository was found at the configured local repository path",
					)
				const repo: Repository = {
					id: "local",
					path: join(backupRoot, "local"),
					passwordFile,
				}
				if (exists) {
					if (recoveryKey) {
						const candidate = join(local, "keys", `candidate-${randomUUID()}`)
						try {
							await atomicWrite(candidate, recoveryKey)
							await engine.checkRepository({ ...repo, passwordFile: candidate })
							await rename(candidate, passwordFile)
						} finally {
							await rm(candidate, { force: true })
						}
					} else await engine.checkRepository(repo)
				} else {
					await atomicWrite(passwordFile, randomBytes(32).toString("base64url"))
					await engine.initializeRepository(repo)
					created = true
				}
				if (!state.repositories.some((entry) => entry.id === "local"))
					state.repositories.push({ id: "local", name: "Local backups" })
				state.enabled = created
				await persist()
			})
			return created
				? jobs.start("backup", {
						name: "",
						note: "",
						kind: "manual",
						pinned: true,
					})
				: null
		},
		listRecoveryPoints: listPoints,
		createBackup: (input: z.input<typeof recoveryMetadata>) =>
			jobs.start("backup", recoveryMetadata.parse(input)),
		check: (id: string, readData: boolean) =>
			jobs.start("check", { repositoryId: id, readData }),
		compare: (id: string, pointId: string) =>
			jobs.start("compare", { repositoryId: id, pointId }),
		async prepareRepair(id: string, pointId: string, paths: string[]) {
			writable()
			const plan = await locks.run(id, () =>
				engine.prepareRepair(mutableRepository(id), {
					pointId,
					paths,
					root: versionsRoot,
				}),
			)
			await atomicWrite(
				join(local, "repairs", `${plan.id}.json`),
				JSON.stringify({
					...plan,
					repositoryId: id,
					libraryId: state.libraryId,
				}),
			)
			return { id: plan.id, files: plan.files.map((entry) => entry.path) }
		},
		repair: (id: string, planId: string) =>
			jobs.start("repair", { repositoryId: id, planId }),
		async prepareRestore(
			id: string,
			pointId: string,
			language?: SupportedLanguage,
		) {
			if (destinationChanging)
				throw new BackupError("storage_busy", "The backup location is changing")
			return locks.run(id, async () => {
				const repo = await checkedRepository(id)
				const point = (await engine.listRecoveryPoints(repo)).find(
					(entry) => entry.id === pointId,
				)
				if (!point)
					throw new BackupError(
						"point_not_found",
						"The recovery point is unavailable",
					)
				const files = await engine.listFiles(repo, point.snapshotId)
				const validationRoot = join(local, "restore-validation", randomUUID())
				try {
					const incoming = await engine.extractDatabase(repo, {
						pointId,
						target: validationRoot,
						includeHistory: true,
					})
					await deps.validateDatabase(incoming.path)
					await deps.validateRecovery?.({
						metadataRoot: validationRoot,
						manifest: incoming.manifest,
						files,
					})
				} finally {
					await rm(validationRoot, { recursive: true, force: true })
				}
				const plan = restorePlanSchema.parse({
					id: randomUUID(),
					instanceId: state.instanceId,
					repositoryId: id,
					pointId,
					snapshotId: point.snapshotId,
					root,
					createdAt: Date.now(),
					confirmationPhrase: language
						? catalogFor(language).protection.restoreConfirmation
						: "RESTORE",
					source: {
						path: await repositoryPhysicalPath(repo.path),
						passwordFile: repo.passwordFile,
						identity: await locations.identity(repo),
					},
				})
				await atomicWrite(
					join(local, "restores", `${plan.id}.json`),
					JSON.stringify(plan),
				)
				return {
					id: plan.id,
					point,
					confirmationPhrase: plan.confirmationPhrase,
					sourcePath: repo.path,
					targetPath: root,
				}
			})
		},
		async restore(planId: string, confirmation: string) {
			if (destinationChanging)
				throw new BackupError("storage_busy", "The backup location is changing")
			if (deps.hasOrphans?.())
				throw new BackupError(
					"native_process_busy",
					"Wait for the previous native operation to stop before restoring",
				)
			z.uuid().parse(planId)
			const plan = restorePlanSchema.parse(
				JSON.parse(
					await readFile(join(local, "restores", `${planId}.json`), "utf8"),
				),
			)
			if (confirmation !== plan.confirmationPhrase)
				throw new BackupError(
					"confirmation_required",
					`Type ${plan.confirmationPhrase} to confirm replacing the library`,
				)
			if (!maintenance && Date.now() - plan.createdAt > 15 * 60_000)
				throw new BackupError(
					"restore_plan_expired",
					"Prepare the restore again",
				)
			if (
				jobs
					.list()
					.some(
						(job) =>
							job.kind === "restore" &&
							["queued", "running", "cancelling"].includes(job.state),
					)
			) {
				throw new BackupError(
					"restore_busy",
					"A restore is already in progress",
				)
			}
			if (
				deps.contextBusy?.() ||
				coordinator.state().frozen ||
				jobs
					.list()
					.some(
						(job) =>
							["backup", "archive", "compare", "repair"].includes(job.kind) &&
							["queued", "running", "cancelling"].includes(job.state),
					)
			) {
				throw new BackupError(
					"storage_busy",
					"Finish or cancel the current storage operation before restoring",
				)
			}
			if (plan.source)
				await locations.identity(
					{ id: plan.repositoryId, ...plan.source },
					plan.source.identity,
				)
			if (
				plan.source &&
				!(await stat(plan.source.passwordFile).catch(() => null))?.isFile()
			)
				throw new BackupError(
					"selection_expired",
					"Open the restore source again",
				)
			await writeMaintenance({ ...plan, phase: "restoring" })
			return jobs.start("restore", { planId })
		},
		async exportRecoveryKey(id: string) {
			const repo = repository(id)
			return {
				repositoryId: id,
				key: await engine.readRecoveryKey(repo),
				format: "hoardodile-restic-v1",
				repositoryPath: repo.path,
				instructions: [
					"Keep this file separately from the repository. The key decrypts every recovery point in that repository.",
					"In the desktop application, choose Restore from another folder, select the backup repository and import this file instead of entering a password. On self-hosted installations, set BACKUP_ROOT to the parent backup directory and open the existing repository with this JSON.",
					"Select a complete recovery point and type the displayed confirmation phrase. This replaces the library; authentication, host settings and the backup location remain unchanged.",
					"For offline inspection, save the key value to a protected password file and run the bundled restic binary with -r <repositoryPath> --password-file <password-file> snapshots --tag hoardodile-published.",
					"Offline extraction: restic -r <repositoryPath> --password-file <password-file> restore <snapshot-id> --target <new-empty-directory> --verify. Use recovery.json inside the restored checkpoint to identify its database. Keep the original repository intact.",
				],
			}
		},
		async updateMetadata(
			id: string,
			pointId: string,
			metadata: z.input<typeof recoveryMetadata>,
		) {
			return locks.run(id, async () => {
				const point = await engine.updateMetadata(
					mutableRepository(id),
					pointId,
					recoveryMetadata.parse(metadata),
				)
				catalogs.delete(id)
				return point
			})
		},
		async updatePolicy(value: z.input<typeof retentionPolicy>) {
			state.policy = retentionPolicy.parse(value)
			await persist()
			return state.policy
		},
		async setAutoBackupInterval(hours: number) {
			state.autoBackupIntervalHours = autoBackupIntervalHours.parse(hours)
			await persist()
			return state.autoBackupIntervalHours
		},
		previewRetention: (id: string) =>
			locks.run(id, () =>
				engine.previewRetention(repository(id), state.policy),
			),
		applyRetention: (id: string, prune: boolean) =>
			jobs.start("retention", { repositoryId: id, prune }),
		drill: (
			id: string,
			pointId: string,
			full: boolean,
			targetId: "local" | "external" = "local",
		) => jobs.start("drill", { repositoryId: id, pointId, full, targetId }),
		async deletePoint(id: string, pointId: string) {
			mutableRepository(id)
			return locks.run(id, async () => {
				await engine.deleteRecoveryPoint(
					repository(id),
					pointId,
					maintenance?.repositoryId === id ? [maintenance.pointId] : [],
				)
				catalogs.delete(id)
			})
		},
		setEnabled: async (enabled: boolean) => {
			state.enabled = enabled
			await persist()
		},
		async scheduleMaintenance() {
			if (maintenance || maintenanceError || deps.isMaintenance?.()) return
			const now = new Date()
			const weekly = new Date(now)
			weekly.setDate(weekly.getDate() - weekly.getDay())
			weekly.setHours(3, 0, 0, 0)
			if (weekly > now) weekly.setDate(weekly.getDate() - 7)
			for (const entry of state.repositories) {
				if (!entry.lastAddedAt || locks.busy(entry.id)) continue
				const active = jobs
					.list()
					.some(
						(job) =>
							job.kind === "retention" &&
							["queued", "running", "cancelling"].includes(job.state) &&
							job.input &&
							typeof job.input === "object" &&
							"repositoryId" in job.input &&
							job.input.repositoryId === entry.id,
					)
				if (active) continue
				const daily =
					(!entry.lastRetentionAt ||
						new Date(entry.lastRetentionAt).toDateString() !==
							now.toDateString()) &&
					entry.lastAddedAt > (entry.lastRetentionAt ?? 0)
				const prune =
					(entry.lastPruneAt ?? entry.lastAddedAt) < weekly.getTime()
				if (daily || prune)
					await jobs.start("retention", { repositoryId: entry.id, prune })
			}
		},
		registerJobHandler: (kind: string, handler: JobHandler) => {
			handlers[kind] = handler
		},
		close: () => jobs.close(),
	}
}

export function schemaFingerprint(sql: string): string {
	return createHash("sha256").update(sql).digest("hex")
}
