import { randomBytes } from "node:crypto"
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import {
	createBackupEngine,
	type JobRecord,
	type Repository,
} from "@hoardodile/backup"
import {
	createStoragePaths,
	ensureBootstrapVersion,
	storageCoordinator,
	writeVersioned,
} from "@hoardodile/host/hoard"
import { eq } from "drizzle-orm"
import { loadEnv } from "src/config/env.ts"
import { getAuthRow } from "src/domain/auth/repo.ts"
import { schema } from "src/infra/db/connection.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createProtectionService, type ProtectionService } from "./service.ts"

const roots: string[] = []
let built: BuiltServer | undefined
afterEach(async () => {
	vi.restoreAllMocks()
	await built?.close()
	built = undefined
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

async function finish(
	service: ProtectionService,
	id: string,
): Promise<JobRecord> {
	const deadline = Date.now() + 120_000
	while (Date.now() < deadline) {
		const job = service.jobs.get(id)
		if (
			job &&
			["succeeded", "failed", "cancelled", "interrupted"].includes(job.state)
		)
			return job
		await delay(100)
	}
	throw new Error("The test operation did not finish")
}

describe("complete library recovery", () => {
	it("rejects a backup directory that aliases the versions tree", async () => {
		const root = await mkdtemp(join(tmpdir(), "hd-backup-overlap-"))
		roots.push(root)
		ensureBootstrapVersion(root)
		const alias = join(root, "backup-alias")
		await symlink(
			join(root, "versions"),
			alias,
			process.platform === "win32" ? "junction" : "dir",
		)
		await expect(
			buildServer({
				env: loadEnv({
					NODE_ENV: "test",
					LOG_LEVEL: "silent",
					STORAGE_ROOT: root,
					BACKUP_ROOT: alias,
					DISABLE_DEV_PLUGINS: "true",
				}),
			}),
		).rejects.toThrow("must not overlap")
	})
	it("exposes a cancellable file request while a backup holds the commit barrier", async () => {
		const root = await mkdtemp(join(tmpdir(), "hd-queued-file-"))
		roots.push(root)
		built = await buildServer({
			env: loadEnv({
				NODE_ENV: "test",
				LOG_LEVEL: "silent",
				STORAGE_ROOT: root,
				DISABLE_DEV_PLUGINS: "true",
			}),
		})
		await built.app.ready()
		const setup = await built.app.inject({
			method: "POST",
			url: "/auth/setup",
			payload: { password: "queue-test-password" },
		})
		expect(setup.statusCode).toBe(200)
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			payload: { password: "queue-test-password" },
		})
		expect(login.statusCode).toBe(200)
		const cookie = login.cookies
			.map((entry) => `${entry.name}=${entry.value}`)
			.join("; ")
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const frozen = storageCoordinator(root).freeze({
			operation: async () => {
				entered.resolve()
				await release.promise
			},
		})
		await entered.promise
		try {
			let completed: { statusCode: number; body: string } | undefined
			const request = built.app
				.inject({
					method: "POST",
					url: "/trpc/resource.create",
					headers: { cookie },
					payload: { name: "Must not commit", defaultNameTimeZone: "UTC" },
				})
				.then((response) => {
					completed = response
					return response
				})
			await vi.waitFor(
				() =>
					expect(
						built!.app.protectionService.jobs
							.list()
							.some((job) => job.kind === "file-write"),
						completed?.body,
					).toBe(true),
				{ timeout: 5000 },
			)
			const job = built.app.protectionService.jobs
				.list()
				.find((entry) => entry.kind === "file-write")!
			await built.app.protectionService.jobs.cancel(job.id)
			expect((await request).statusCode).toBeGreaterThanOrEqual(400)
			expect(built.app.db.select().from(schema.resources).all()).toHaveLength(0)
			expect(built.app.protectionService.jobs.get(job.id)?.state).toBe(
				"cancelled",
			)
		} finally {
			release.resolve()
			await frozen
		}
	}, 15_000)
	it("restores files and data, preserves host state, and resumes a failed restore after restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "hd-recovery-lifecycle-"))
		roots.push(root)
		const drillRoot = join(root, "drill-disk")
		await mkdir(drillRoot)
		await writeFile(join(drillRoot, "keep.txt"), "unrelated file")
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			MIN_FREE_DISK_BYTES: "1",
			RECOVERY_DRILL_ROOT: drillRoot,
			DISABLE_DEV_PLUGINS: "true",
		})
		built = await buildServer({ env })
		await built.app.ready()
		const app = built.app
		const setup = await app.inject({
			method: "POST",
			url: "/auth/setup",
			payload: { password: "local-password" },
		})
		expect(setup.statusCode).toBe(200)
		const password = getAuthRow(app.hostDb)?.hash
		expect(password).toBeDefined()
		const original = await app.resService.create({ name: "Original" })
		const media = join(app.paths.latest.resourceData(original.id), "media.bin")
		const bytes = randomBytes(64 * 1024)
		await writeVersioned(app.paths, false, async () => {
			await mkdir(app.paths.latest.resourceData(original.id), {
				recursive: true,
			})
			await writeFile(media, bytes)
		})
		await app.syncService.deviceCreate({ name: "First device", notes: "" })
		const initial = await app.protectionService.initialize()
		expect(initial).not.toBeNull()
		const backup = await finish(app.protectionService, initial!.id)
		expect(backup.state, JSON.stringify(backup.error)).toBe("succeeded")
		const point = (await app.protectionService.listRecoveryPoints("local"))[0]!
		const drill = await app.protectionService.drill(
			"local",
			point.id,
			true,
			"external",
		)
		expect((await finish(app.protectionService, drill.id)).state).toBe(
			"succeeded",
		)
		expect(await readdir(drillRoot)).toEqual(["keep.txt"])
		expect(await readFile(join(drillRoot, "keep.txt"), "utf8")).toBe(
			"unrelated file",
		)
		await app.resService.update({ id: original.id, name: "Local edits" })
		await app.resService.create({ name: "Discard this resource" })
		await app.syncService.deviceCreate({
			name: "Keep this local device",
			notes: "Host only",
		})
		const extra = join(app.paths.latest.root, "extra.bin")
		await writeVersioned(app.paths, false, async () => {
			await writeFile(media, "changed")
			await writeFile(extra, "extra")
		})
		const plan = await app.protectionService.prepareRestore("local", point.id)
		await expect(
			app.protectionService.restore(plan.id, "incorrect"),
		).rejects.toThrow("RESTORE")
		expect(app.protectionService.getStatus().maintenance).toBeNull()
		const requested = await app.protectionService.restore(plan.id, "RESTORE")
		const restored = await finish(app.protectionService, requested.id)
		expect(restored.state, JSON.stringify(restored.error)).toBe("succeeded")
		expect(await readFile(media)).toEqual(bytes)
		await expect(stat(extra)).rejects.toMatchObject({ code: "ENOENT" })
		expect(
			app.db
				.select()
				.from(schema.resources)
				.all()
				.map((row) => row.name),
		).toEqual(["Original"])
		expect(getAuthRow(app.hostDb)?.hash).toBe(password)
		expect((await app.syncService.summary()).devices).toHaveLength(2)
		const secondPlan = await app.protectionService.prepareRestore(
			"local",
			point.id,
		)
		vi.spyOn(app.protectionService.engine, "restore").mockImplementationOnce(
			async () => {
				await writeFile(media, "partial restore")
				throw new Error("Injected I/O failure")
			},
		)
		const failed = await app.protectionService.restore(secondPlan.id, "RESTORE")
		expect((await finish(app.protectionService, failed.id)).state).toBe(
			"failed",
		)
		expect(app.libraryMaintenance).toBe(true)
		expect(
			(await app.inject({ method: "GET", url: "/trpc/resource.list" }))
				.statusCode,
		).toBe(503)
		await built.close()
		built = undefined
		vi.restoreAllMocks()
		built = await buildServer({ env })
		await built.app.ready()
		expect(built.app.libraryMaintenance).toBe(true)
		expect(
			(
				await built.app.inject({ method: "GET", url: "/api/protection/state" })
			).json(),
		).toEqual({ maintenance: true })
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			payload: { password: "local-password" },
		})
		expect(login.statusCode).toBe(200)
		const retried = await built.app.protectionService.jobs.retry(failed.id)
		const completed = await finish(built.app.protectionService, retried.id)
		expect(completed.state, JSON.stringify(completed.error)).toBe("succeeded")
		expect(await readFile(media)).toEqual(bytes)
		expect(
			built.app.db
				.select()
				.from(schema.resources)
				.where(eq(schema.resources.id, original.id))
				.get()?.name,
		).toBe("Original")
		expect(getAuthRow(built.app.hostDb)?.hash).toBe(password)
		expect(built.app.libraryMaintenance).toBe(false)
	}, 180_000)

	it("adopts an existing repository without backing up an empty library or replacing a valid key with an invalid one", async () => {
		const root = await mkdtemp(join(tmpdir(), "hd-repository-adoption-"))
		roots.push(root)
		const backupRoot = join(root, "backups")
		const originalKey = join(root, "original-key")
		await writeFile(originalKey, "known-recovery-key")
		const engine = createBackupEngine({ cacheDir: join(root, "cache") })
		const repo: Repository = {
			id: "local",
			path: join(backupRoot, "local"),
			passwordFile: originalKey,
		}
		await engine.initializeRepository(repo)
		const library = join(root, "library")
		ensureBootstrapVersion(library)
		const service = await createProtectionService({
			paths: () => createStoragePaths({ root: library }),
			backupRoot,
			appVersion: "test",
			minFreeBytes: 1,
			engine,
			assertArchivable: () => {},
			enterMaintenance: async () => {},
			validateDatabase: async () => {},
			installDatabase: async () => {},
			reloadLibrary: async () => {},
			leaveMaintenance: () => {},
		})
		try {
			expect(await service.initialize("known-recovery-key")).toBeNull()
			expect(service.jobs.list()).toHaveLength(0)
			expect(service.getStatus().enabled).toBe(false)
			await expect(service.initialize("wrong-key")).rejects.toThrow()
			expect(
				await readFile(service.repository("local").passwordFile, "utf8"),
			).toBe("known-recovery-key")
		} finally {
			await service.close()
		}
	}, 60_000)
})
