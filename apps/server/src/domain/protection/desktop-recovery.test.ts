import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { JobRecord } from "@hoardodile/backup"
import { loadEnv } from "src/config/env.ts"
import { getAuthRow } from "src/domain/auth/repo.ts"
import { schema } from "src/infra/db/connection.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, expect, it, vi } from "vitest"
import type { ProtectionService } from "./service.ts"

let built: BuiltServer | undefined
const roots: string[] = []
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
	for (let attempt = 0; attempt < 1200; attempt++) {
		const job = service.jobs.get(id)
		if (job && !["queued", "running", "cancelling"].includes(job.state))
			return job
		await delay(100)
	}
	throw new Error("Backup operation did not finish")
}

it("restores a password-protected external copy across restart without adopting it as the backup destination", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-desktop-recovery-"))
	roots.push(root)
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: join(root, "library"),
		HOARDODILE_SHUTDOWN_TOKEN: "desktop-test-token",
		DISABLE_DEV_PLUGINS: "true",
		MIN_FREE_DISK_BYTES: "1",
	})
	built = await buildServer({ env })
	await built.app.ready()
	const app = built.app
	const setup = await app.inject({
		method: "POST",
		url: "/auth/setup",
		payload: { password: "login-password" },
	})
	expect(setup.statusCode).toBe(200)
	const auth = getAuthRow(app.hostDb)?.hash
	const item = await app.resService.create({ name: "Original" })
	const service = app.protectionService
	await expect(service.initialize()).rejects.toThrow()
	const initial = await service.initialize(undefined, "backup-password")
	expect((await finish(service, initial!.id)).state).toBe("succeeded")
	const originalPath = service.getStatus().localRepositoryPath
	const originalKey = await service.exportRecoveryKey("local")
	expect(originalKey.key).not.toBe("backup-password")
	const external = join(root, "external-copy")
	await cp(originalPath, external, { recursive: true })
	await service.setEnabled(false)
	await service.setAutoBackupInterval(6)
	await service.updatePolicy({ automatic: 2 })
	const destination = join(root, "new-destination")
	await mkdir(destination)
	const pickedDestination = await service.registerFolder(destination, "backup")
	const next = await service.setBackupLocation({
		selectionId: pickedDestination.id,
		password: "other-password",
	})
	expect((await finish(service, next!.id)).state).toBe("succeeded")
	const before = service.getStatus()
	expect(before.enabled).toBe(false)
	const selection = await service.registerFolder(external, "restore")
	const opened = await service.openRestoreSource({
		selectionId: selection.id,
		credential: "backup-password",
	})
	await expect(
		service.deletePoint(
			opened.repositoryId,
			(await service.listRecoveryPoints(opened.repositoryId))[0]!.id,
		),
	).rejects.toMatchObject({ code: "restore_only" })
	const point = (await service.listRecoveryPoints(opened.repositoryId))[0]!
	const sourceKey = service.repository(opened.repositoryId).passwordFile
	await app.resService.update({ id: item.id, name: "Changed" })
	const plan = await service.prepareRestore(opened.repositoryId, point.id, "zh")
	expect(plan.confirmationPhrase).toBe("还原")
	expect(plan.targetPath).toBe(env.STORAGE_ROOT)
	await expect(service.restore(plan.id, "restore")).rejects.toMatchObject({
		code: "confirmation_required",
	})
	await rename(external, join(root, "disconnected"))
	await expect(service.restore(plan.id, "还原")).rejects.toMatchObject({
		code: "repository_offline",
	})
	expect(service.getStatus().maintenance).toBeNull()
	await rename(join(root, "disconnected"), external)
	vi.spyOn(service.engine, "restore").mockRejectedValueOnce(
		new Error("Interrupted restore"),
	)
	const job = await service.restore(plan.id, "还原")
	expect((await finish(service, job.id)).state).toBe("failed")
	expect(await readFile(sourceKey, "utf8")).toBe("backup-password")
	await built.close()
	built = undefined
	vi.restoreAllMocks()
	built = await buildServer({ env })
	await built.app.ready()
	const restarted = built.app.protectionService
	const retry = await restarted.jobs.retry(job.id)
	expect((await finish(restarted, retry.id)).state).toBe("succeeded")
	expect(
		built.app.db
			.select()
			.from(schema.resources)
			.all()
			.map((row) => row.name),
	).toEqual(["Original"])
	expect(getAuthRow(built.app.hostDb)?.hash).toBe(auth)
	expect(restarted.getStatus()).toMatchObject({
		enabled: false,
		autoBackupIntervalHours: 6,
		policy: { automatic: 2 },
		localRepositoryPath: before.localRepositoryPath,
		lastBackupAt: before.lastBackupAt,
		maintenance: null,
	})
	await expect(readFile(sourceKey)).rejects.toMatchObject({ code: "ENOENT" })
	const useOriginal = await restarted.registerFolder(originalPath, "backup")
	await restarted.setBackupLocation({
		selectionId: useOriginal.id,
		credential: "backup-password",
	})
	expect(restarted.getStatus().localRepositoryPath).toBe(originalPath)
	expect((await restarted.exportRecoveryKey("local")).key).toBe(originalKey.key)
	const newPoint = await restarted.createBackup({
		kind: "manual",
		pinned: true,
	})
	expect((await finish(restarted, newPoint.id)).state).toBe("succeeded")
	expect(await restarted.listRecoveryPoints("local")).toHaveLength(2)
}, 180_000)

it("restricts folder registration to token-authorized loopback requests", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-folder-auth-"))
	roots.push(root)
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: join(root, "library"),
		HOARDODILE_SHUTDOWN_TOKEN: "desktop-test-token",
		DISABLE_DEV_PLUGINS: "true",
	})
	built = await buildServer({ env })
	await built.app.ready()
	const path = join(root, "backup")
	await mkdir(path)
	const request = {
		method: "POST" as const,
		url: "/api/internal/protection/folder",
		payload: { path, purpose: "backup" },
		remoteAddress: "127.0.0.1",
	}
	expect((await built.app.inject(request)).statusCode).toBe(401)
	expect(
		(
			await built.app.inject({
				...request,
				remoteAddress: "192.0.2.10",
				headers: { "x-shutdown-token": "desktop-test-token" },
			})
		).statusCode,
	).toBe(403)
	// Windows temp paths may use 8.3 names; registration returns the real path.
	expect(
		(
			await built.app.inject({
				...request,
				headers: { "x-shutdown-token": "desktop-test-token" },
			})
		).json(),
	).toMatchObject({
		path: await realpath(path),
		exists: false,
		purpose: "backup",
	})
	expect(
		(
			await built.app.inject({
				...request,
				payload: { path: "relative", purpose: "backup" },
				headers: { "x-shutdown-token": "desktop-test-token" },
			})
		).statusCode,
	).toBe(400)
}, 30_000)
