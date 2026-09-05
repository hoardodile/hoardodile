import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import {
	atomicWrite,
	isMissing,
	type RecoveryManifest,
	recoveryManifest,
	sha256File,
} from "@hoardodile/backup"
import { listVersions, type StoragePaths } from "@hoardodile/host/hoard"
import { createDatabaseCheckpoint } from "src/infra/db/checkpoint.ts"
import { z } from "zod"
import { diskReferenceTree, verifyDatabaseReferences } from "./references.ts"

const pendingSchema = z.object({
	version: z.number().int().positive(),
	phase: z.enum(["prepared", "old-moved", "published"]),
})
const CHECKPOINT_DIRECTORY = "checkpoint"

/** Recover a directory publication before any backup is allowed to inspect versions. */
export async function recoverCheckpointPublication(
	root: string,
): Promise<void> {
	const work = join(root, "local", "checkpoint-publication")
	const marker = join(work, "pending.json")
	let pending: z.infer<typeof pendingSchema>
	try {
		pending = pendingSchema.parse(JSON.parse(await readFile(marker, "utf8")))
	} catch (error) {
		if (isMissing(error)) return
		throw error
	}
	const target = join(
		root,
		"versions",
		String(pending.version),
		CHECKPOINT_DIRECTORY,
	)
	const staged = join(work, "next")
	const previous = join(work, "previous")
	const exists = async (path: string) => {
		try {
			await readdir(path)
			return true
		} catch (error) {
			if (isMissing(error)) return false
			throw error
		}
	}
	if (!(await exists(target))) {
		if (await exists(staged)) await rename(staged, target)
		else if (await exists(previous)) await rename(previous, target)
		else throw new Error("Checkpoint publication lost both generations")
	}
	await rm(work, { recursive: true, force: true })
}

export async function prepareCheckpoint(options: {
	paths: StoragePaths
	instanceId: string
	libraryId: string
	appVersion: string
	signal?: AbortSignal
}): Promise<RecoveryManifest> {
	const { paths } = options
	await recoverCheckpointPublication(paths.root)
	const work = join(paths.local.root, "checkpoint-publication")
	await rm(work, { recursive: true, force: true })
	const staged = join(work, "next")
	const previous = join(work, "previous")
	const target = join(paths.latest.root, CHECKPOINT_DIRECTORY)
	await mkdir(staged, { recursive: true })
	const database = join(staged, "app.sqlite")
	try {
		const snapshot = await createDatabaseCheckpoint({
			source: paths.runtimeDb(),
			destination: database,
			signal: options.signal,
		})
		await verifyDatabaseReferences({
			database,
			archiveVersion: paths.latestVersion,
			tree: diskReferenceTree(paths.root, join(paths.root, "versions")),
		})
		const plugins: RecoveryManifest["plugins"] = []
		for (const version of listVersions(paths.root)) {
			const directory = paths.atVersion(version).plugins()
			let entries: string[]
			try {
				entries = await readdir(directory)
			} catch (error) {
				if (isMissing(error)) continue
				throw error
			}
			for (const id of entries) {
				const file = join(directory, id, "manifest.json")
				let manifest: { id: string; version: string }
				try {
					manifest = z
						.object({ id: z.string(), version: z.string() })
						.parse(JSON.parse(await readFile(file, "utf8")))
				} catch (error) {
					if (isMissing(error)) continue
					throw error
				}
				plugins.push({
					id: manifest.id,
					version: manifest.version,
					archiveVersion: version,
					manifestSha256: await sha256File(file),
				})
			}
		}
		const manifest = recoveryManifest.parse({
			formatVersion: 1,
			recoveryPointId: randomUUID(),
			instanceId: options.instanceId,
			libraryId: options.libraryId,
			createdAt: snapshot.createdAt,
			appVersion: options.appVersion,
			latestVersion: paths.latestVersion,
			databasePath: relative(
				join(paths.root, "versions"),
				join(target, "app.sqlite"),
			)
				.split(sep)
				.join("/"),
			databaseSha256: await sha256File(database),
			databaseSchema: createHash("sha256")
				.update(snapshot.schema)
				.digest("hex"),
			plugins,
		})
		await atomicWrite(join(staged, "recovery.json"), JSON.stringify(manifest))
		const marker = join(work, "pending.json")
		await atomicWrite(
			marker,
			JSON.stringify({ version: paths.latestVersion, phase: "prepared" }),
		)
		try {
			await rename(target, previous)
		} catch (error) {
			if (!isMissing(error)) throw error
		}
		await atomicWrite(
			marker,
			JSON.stringify({ version: paths.latestVersion, phase: "old-moved" }),
		)
		await rename(staged, target)
		await atomicWrite(
			marker,
			JSON.stringify({ version: paths.latestVersion, phase: "published" }),
		)
		await rm(work, { recursive: true, force: true })
		return manifest
	} catch (error) {
		await recoverCheckpointPublication(paths.root)
		throw error
	}
}
