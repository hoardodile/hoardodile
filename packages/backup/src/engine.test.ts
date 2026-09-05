import { randomBytes, randomUUID } from "node:crypto"
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createBackupEngine } from "./engine.ts"
import { atomicWrite, confinedPath, sha256File } from "./files.ts"
import type { RecoveryManifest, Repository } from "./types.ts"

const temporary: string[] = []
afterEach(async () => {
	for (const path of temporary.splice(0))
		await rm(path, { recursive: true, force: true })
})

describe("backup engine", () => {
	it("backs up, copies, detects unchanged-metadata corruption, repairs and restores an exact tree", async () => {
		const root = await mkdtemp(join(tmpdir(), "hd-backup-test-"))
		temporary.push(root)
		const source = join(root, "source")
		const versions = join(source, "versions")
		const checkpoint = join(versions, "1", "checkpoint.sqlite")
		await mkdir(join(versions, "1"), { recursive: true })
		await writeFile(checkpoint, "database checkpoint")
		const payload = randomBytes(128 * 1024)
		const file = join(versions, "1", "original.bin")
		await writeFile(file, payload)
		const passwordFile = join(root, "password")
		await atomicWrite(passwordFile, "integration-test-password")
		const repo: Repository = {
			id: "source",
			path: join(root, "repository"),
			passwordFile,
		}
		const engine = createBackupEngine({ cacheDir: join(root, "cache") })
		await engine.capabilities()
		await engine.initializeRepository(repo)
		const manifest: RecoveryManifest = {
			formatVersion: 1,
			recoveryPointId: randomUUID(),
			libraryId: randomUUID(),
			instanceId: randomUUID(),
			createdAt: Date.now(),
			appVersion: "test",
			latestVersion: 1,
			databasePath: "1/checkpoint.sqlite",
			databaseSha256: await sha256File(checkpoint),
			databaseSchema: "test",
			plugins: [],
		}
		await writeFile(
			join(versions, "1", "recovery.json"),
			JSON.stringify(manifest),
		)
		const point = await engine.createBackup(repo, {
			storageRoot: source,
			manifest,
			metadata: { name: "Checkpoint", note: "", kind: "manual", pinned: true },
		})
		expect(point.id).toBe(manifest.recoveryPointId)
		const before = await stat(file)
		await writeFile(file, Buffer.alloc(payload.length, 0))
		await utimes(file, before.atime, before.mtime)
		await writeFile(join(versions, "1", "extra.bin"), "extra")
		const diff = await engine.compareSource(repo, {
			pointId: point.id,
			root: versions,
		})
		expect(diff).toContainEqual({ path: "1/original.bin", status: "changed" })
		expect(diff).toContainEqual({ path: "1/extra.bin", status: "extra" })
		const plan = await engine.prepareRepair(repo, {
			pointId: point.id,
			root: versions,
			paths: ["1/original.bin"],
		})
		await engine.repair(repo, {
			root: versions,
			staging: join(root, "repair"),
			plan,
		})
		expect(await readFile(file)).toEqual(payload)
		const destination: Repository = {
			id: "copy",
			path: join(root, "copy"),
			passwordFile,
		}
		await engine.initializeRepository(destination, { source: repo })
		await engine.copy(destination, {
			source: repo,
			snapshotId: point.snapshotId,
		})
		expect((await engine.listRecoveryPoints(destination))[0]?.id).toBe(point.id)
		await engine.restore(destination, {
			pointId: point.id,
			target: versions,
			deleteExtra: true,
		})
		await expect(stat(join(versions, "1", "extra.bin"))).rejects.toMatchObject({
			code: "ENOENT",
		})
		expect(await readFile(file)).toEqual(payload)
	}, 120_000)

	it("rejects paths that escape the selected restore root", () => {
		for (const name of [
			"../other",
			"/root",
			"a/../../other",
			"a\\b",
			"a:stream",
			"a//b",
		]) {
			expect(() => confinedPath(tmpdir(), name)).toThrow()
		}
	})
})
