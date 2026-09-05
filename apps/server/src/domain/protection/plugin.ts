import { copyFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
	confinedPath,
	inspectManagedProcesses,
	isMissing,
} from "@hoardodile/backup"
import {
	recoverVersionPublication,
	writeActiveVersion,
} from "@hoardodile/host/hoard"
import BetterSqlite3 from "better-sqlite3"
import type { FastifyInstance } from "fastify"
import { assertArchivablePlugins } from "src/domain/plugin/archivable.ts"
import { openDb } from "src/infra/db/connection.ts"
import { verifySqliteIntegrity } from "src/infra/db/snapshot.ts"
import { recoverCheckpointPublication } from "src/infra/storage/checkpoint.ts"
import { validateRecoveryMetadata } from "src/infra/storage/recovery-metadata.ts"
import workspaceManifest from "../../../../../package.json" with {
	type: "json",
}
import { createProtectionService, protectionDirectory } from "./service.ts"

export async function registerProtection(
	app: FastifyInstance,
	reload: () => Promise<unknown>,
): Promise<void> {
	let observer: InstanceType<typeof BetterSqlite3> | undefined
	let observedVersion: number | undefined
	let observedFiles: number | undefined
	let autoJobId: string | undefined
	let pendingObservation: { database: number; files: number } | undefined
	let polling = false
	const local = protectionDirectory(app.env.STORAGE_ROOT)
	const validateDatabase = async (path: string) => {
		if (!verifySqliteIntegrity(path))
			throw new Error("The recovery database is corrupt")
		const handles = openDb(path)
		try {
			handles.validateCompatibility?.()
			handles.runMigrations()
			if (!handles.integrityCheck())
				throw new Error("The recovery database is incompatible")
		} finally {
			handles.close()
		}
	}
	const service = await createProtectionService({
		paths: () => app.paths,
		backupRoot: app.env.BACKUP_ROOT ?? join(app.env.STORAGE_ROOT, "backups"),
		drillRoot: app.env.RECOVERY_DRILL_ROOT,
		appVersion: workspaceManifest.version,
		minFreeBytes: app.env.MIN_FREE_DISK_BYTES,
		isMaintenance: () => app.libraryMaintenance,
		contextBusy: () => app.pendingStorageReloads > 0,
		hasOrphans: () => app.nativeProcessesBusy,
		repositoryServing: (id) =>
			id === "local" &&
			(app.replicationService?.getStatus().activeTransfers ?? 0) > 0,
		assertArchivable: () => assertArchivablePlugins(app),
		validateDatabase,
		validateRecovery: (input) =>
			validateRecoveryMetadata({
				...input,
				validateDatabase,
				appVersion: workspaceManifest.version,
			}),
		async enterMaintenance() {
			app.libraryMaintenance = true
			for (const request of app.activeStorageRequests)
				if (request.storageWaiting) request.storageAbort?.abort()
			app.pluginAssetConsent.dispose()
			const deadline = Date.now() + 60_000
			while (app.inflightRequests > 0 && Date.now() < deadline) await delay(25)
			if (app.inflightRequests > 0)
				throw new Error(
					`Active library requests did not finish: ${[...app.activeStorageRequests].map((request) => request.url.split("?", 1)[0]).join(", ")}`,
				)
			await app.stopPluginWorkers()
			await app.resService.drainMetaQueue()
			await rm(join(app.paths.local.root, "plugin-transactions"), {
				recursive: true,
				force: true,
			})
			observer?.close()
			observer = undefined
			app.runtimeRefs.dbHandles.current.close()
		},
		async installDatabase(manifest) {
			const source = confinedPath(
				join(app.paths.root, "versions"),
				manifest.databasePath,
			)
			if (!verifySqliteIntegrity(source))
				throw new Error("The restored database is corrupt")
			const temporary = join(local, "runtime-next.sqlite")
			await copyFile(source, temporary)
			for (const suffix of ["-wal", "-shm"])
				await rm(`${app.paths.runtimeDb()}${suffix}`, { force: true })
			await rename(temporary, app.paths.runtimeDb())
			writeActiveVersion(app.paths.root, manifest.latestVersion)
		},
		async reloadLibrary() {
			await rm(app.paths.local.cache(), { recursive: true, force: true })
			await reload()
			observedVersion = undefined
			observedFiles = undefined
		},
		leaveMaintenance: () => {
			app.libraryMaintenance = false
		},
		onError: (error) =>
			app.log.error({ err: error }, "protection.operation_failed"),
	})
	app.decorate("protectionService", service)
	service.registerJobHandler("archive", async (input, context) => {
		if (app.libraryMaintenance)
			throw new Error("The library is in maintenance mode")
		depsAssertArchiveInput(input)
		context.progress({ phase: "archive" })
		return app.versionService.create(input, {
			signal: context.signal,
			onProgress: context.progress,
			afterPublish: async () => {
				await reload()
			},
		})
	})
	app.libraryMaintenance =
		app.nativeProcessesBusy ||
		service.getStatus().maintenance !== null ||
		service.getStatus().maintenanceError !== null
	let checkingProcesses = false
	const processTimer = setInterval(() => {
		if (!app.nativeProcessesBusy || checkingProcesses) return
		checkingProcesses = true
		void (async () => {
			const processes = await inspectManagedProcesses(join(local, "processes"))
			if (processes.active || processes.uncertain) return
			app.nativeProcessesBusy = false
			await service.cleanupInterruptedDrills()
			const status = service.getStatus()
			if (!status.maintenance && !status.maintenanceError) {
				await recoverVersionPublication(app.paths.root)
				await recoverCheckpointPublication(app.paths.root)
				await reload()
				app.libraryMaintenance = false
			}
		})()
			.catch((error) =>
				app.log.error({ error }, "protection.process_recovery_failed"),
			)
			.finally(() => {
				checkingProcesses = false
			})
	}, 1000)
	processTimer.unref()
	async function poll() {
		if (
			polling ||
			app.libraryMaintenance ||
			!service.getStatus().enabled ||
			app.env.DATABASE_URL === ":memory:"
		)
			return
		polling = true
		try {
			if (autoJobId) {
				const job = service.jobs.get(autoJobId)
				if (job && ["queued", "running", "cancelling"].includes(job.state))
					return
				if (job?.state === "succeeded" && pendingObservation) {
					observedVersion = pendingObservation.database
					observedFiles = pendingObservation.files
				}
				autoJobId = undefined
				pendingObservation = undefined
			}
			observer ??= new BetterSqlite3(app.paths.runtimeDb(), {
				readonly: true,
				fileMustExist: true,
			})
			const database = Number(observer.pragma("data_version", { simple: true }))
			const files = service.getStatus().storage.revision
			if (database !== observedVersion || files !== observedFiles) {
				pendingObservation = { database, files }
				autoJobId = (
					await service.createBackup({
						name: "",
						note: "",
						kind: "auto",
						pinned: false,
					})
				).id
			}
		} catch (error) {
			if (!isMissing(error))
				app.log.error({ error }, "protection.scheduler_failed")
		} finally {
			polling = false
		}
	}
	const timer = setInterval(() => {
		void poll()
			.then(() => service.scheduleMaintenance())
			.catch((error) =>
				app.log.error({ error }, "protection.maintenance_failed"),
			)
	}, 5 * 60_000)
	timer.unref()
	app.addHook("onReady", async () => {
		void poll()
	})
	app.addHook("preClose", async () => {
		clearInterval(timer)
		clearInterval(processTimer)
		await service.close()
		observer?.close()
		observer = undefined
	})
}

function depsAssertArchiveInput(
	input: unknown,
): asserts input is { name?: string; note?: string } {
	if (
		!input ||
		typeof input !== "object" ||
		("name" in input && typeof input.name !== "string") ||
		("note" in input && typeof input.note !== "string")
	)
		throw new Error("Invalid archive request")
}
