import { randomFillSync, randomUUID } from "node:crypto"
import {
	mkdir,
	mkdtemp,
	open,
	rename,
	rm,
	statfs,
	writeFile,
} from "node:fs/promises"
import { cpus, freemem, platform, totalmem } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import {
	createBackupEngine,
	type RecoveryManifest,
	type RecoveryPoint,
	type Repository,
	sha256File,
} from "../src/index.ts"

const bytes = Number(process.env.BACKUP_BENCH_GB ?? 1) * 1_000_000_000
if (!Number.isSafeInteger(bytes) || bytes < 1_000_000_000)
	throw new Error("BACKUP_BENCH_GB must be a positive whole number")
const parent = resolve(
	process.env.BACKUP_BENCH_ROOT ?? join(import.meta.dirname, "../../../tmp"),
)
await mkdir(parent, { recursive: true })
const disk = await statfs(parent)
if (disk.bavail * disk.bsize < bytes * 3.15 + 10_000_000_000)
	throw new Error(
		"The benchmark requires space for its source and two repositories",
	)
const root = await mkdtemp(join(parent, "hd-backup-benchmark-"))
const results: Record<string, unknown> = {
	bytes,
	root,
	platform: platform(),
	cpu: cpus()[0]?.model,
	memory: totalmem(),
	availableMemory: freemem(),
	startedAt: new Date().toISOString(),
	fixture:
		"Unique cryptographic random bytes, large files and 22,000 small files; no sparse or repeated payloads",
}
const report = join(parent, "backup-benchmark-result.json")
const persist = () => writeFile(report, JSON.stringify(results, null, 2))
async function cleanupFixture() {
	if (
		dirname(resolve(root)) !== parent ||
		!basename(root).startsWith("hd-backup-benchmark-")
	)
		throw new Error("Unexpected benchmark cleanup target")
	await rm(root, { recursive: true, force: true })
}
async function measure<T>(
	name: string,
	operation: () => Promise<T>,
): Promise<T> {
	console.log(JSON.stringify({ stage: name, status: "started" }))
	const start = performance.now()
	const result = await operation()
	results[name] = { seconds: (performance.now() - start) / 1000, result }
	await persist()
	console.log(JSON.stringify({ stage: name, ...(results[name] as object) }))
	return result
}
async function randomFile(path: string, length: number): Promise<void> {
	const buffer = Buffer.allocUnsafe(Math.min(length, 16 * 1024 * 1024))
	const handle = await open(path, "wx")
	try {
		let remaining = length
		while (remaining > 0) {
			const chunk = buffer.subarray(0, Math.min(remaining, buffer.length))
			randomFillSync(chunk)
			let offset = 0
			while (offset < chunk.length)
				offset += (await handle.write(chunk, offset, chunk.length - offset))
					.bytesWritten
			remaining -= chunk.length
		}
		await handle.sync()
	} finally {
		await handle.close()
	}
}
const source = join(root, "source")
const versions = join(source, "versions")
const current = join(versions, "1")
const large = join(current, "large")
const small = join(current, "small")
const key = join(root, "key")
const repository: Repository = {
	id: "local",
	path: join(root, "repository"),
	passwordFile: key,
}
const received: Repository = {
	id: "received",
	path: join(root, "received"),
	passwordFile: key,
}
const engine = createBackupEngine({ cacheDir: join(root, "cache") })
const manifest: RecoveryManifest = {
	formatVersion: 1,
	recoveryPointId: randomUUID(),
	libraryId: randomUUID(),
	instanceId: randomUUID(),
	createdAt: Date.now(),
	appVersion: "benchmark",
	latestVersion: 1,
	databasePath: "1/checkpoint.sqlite",
	databaseSha256: "",
	databaseSchema: "synthetic-throughput-fixture",
	plugins: [],
}
async function backup(): Promise<RecoveryPoint> {
	manifest.recoveryPointId = randomUUID()
	manifest.createdAt = Date.now()
	await writeFile(join(current, "recovery.json"), JSON.stringify(manifest))
	return engine.createBackup(repository, {
		storageRoot: source,
		manifest,
		metadata: { kind: "auto", pinned: false, name: "Benchmark", note: "" },
	})
}
try {
	await measure("fixture", async () => {
		await mkdir(large, { recursive: true })
		await mkdir(small)
		let remaining = bytes - 22000 * 4096
		let index = 0
		while (remaining > 0) {
			const length = Math.min(remaining, 1_000_000_000)
			await randomFile(join(large, `${index++}.bin`), length)
			remaining -= length
		}
		for (let i = 0; i < 22000; i++)
			await randomFile(join(small, `${i}.bin`), 4096)
		await writeFile(
			join(current, "checkpoint.sqlite"),
			"Synthetic checkpoint for engine throughput only",
		)
		manifest.databaseSha256 = await sha256File(
			join(current, "checkpoint.sqlite"),
		)
		await writeFile(key, randomUUID())
		return { bytes, files: index + 22000 }
	})
	await engine.capabilities()
	await engine.initializeRepository(repository)
	await measure("initialBackup", backup)
	await measure("unchangedBackup", backup)
	await measure("incrementFixture", () =>
		randomFile(join(large, "increment.bin"), 1_000_000_000),
	)
	await measure("incrementBackup", backup)
	await rename(large, join(current, "renamed"))
	const point = await measure("renamedDirectoryBackup", backup)
	await engine.initializeRepository(received, { source: repository })
	await measure("copyToSecondRepository", () =>
		engine.copy(received, { source: repository, snapshotId: point.snapshotId }),
	)
	await measure("fullContentCheck", () =>
		engine.checkRepository(received, { readData: true }),
	)
	await measure("compareExistingLibrary", () =>
		engine.compareSource(received, { pointId: point.id, root: versions }),
	)
	await measure("restoreExistingLibrary", () =>
		engine.restore(received, {
			pointId: point.id,
			target: versions,
			deleteExtra: true,
		}),
	)
	results.completedAt = new Date().toISOString()
} catch (error) {
	results.error = error instanceof Error ? error.message : String(error)
	process.exitCode = 1
} finally {
	await persist()
	// Only this invocation's freshly created fixture may be removed.
	await cleanupFixture()
	console.log(JSON.stringify({ report, error: results.error ?? null }))
}
