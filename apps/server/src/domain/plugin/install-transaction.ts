import { randomUUID } from "node:crypto"
import {
	cp,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
} from "node:fs/promises"
import { join } from "node:path"
import { atomicWrite, isMissing, walkFiles } from "@hoardodile/backup"
import { assertSafeSegment, type StoragePaths } from "@hoardodile/host/hoard"
import { z } from "zod"

const journalSchema = z.object({
	version: z.number().int().positive(),
	pluginId: z.string().min(1),
})
const pending = new Map<string, Promise<unknown>>()
async function exists(path: string) {
	try {
		await stat(path)
		return true
	} catch (error) {
		if (isMissing(error)) return false
		throw error
	}
}

/** Replay only registered transactions; incomplete preparation never touches installed files. */
export async function recoverPluginInstallations(
	paths: StoragePaths,
): Promise<void> {
	const base = join(paths.local.root, "plugin-transactions")
	let entries: string[]
	try {
		entries = await readdir(base)
	} catch (error) {
		if (isMissing(error)) return
		throw error
	}
	for (const id of entries) {
		if (!z.uuid().safeParse(id).success) continue
		const work = join(base, id)
		const marker = join(work, "pending.json")
		if (!(await exists(marker))) {
			await rm(work, { recursive: true, force: true })
			continue
		}
		const journal = journalSchema.parse(
			JSON.parse(await readFile(marker, "utf8")),
		)
		if (journal.version !== paths.latestVersion)
			throw new Error("A plugin transaction targets a frozen archive")
		const target = join(
			paths.latest.plugins(),
			assertSafeSegment(journal.pluginId),
		)
		if (!(await exists(target))) {
			const next = join(work, "next")
			const previous = join(work, "previous")
			if (await exists(previous)) await rename(previous, target)
			else if (await exists(next)) await rename(next, target)
			else throw new Error("The plugin transaction lost both generations")
		}
		await rm(work, { recursive: true, force: true })
	}
}

export async function installPluginTransaction(options: {
	paths: StoragePaths
	pluginId: string
	staging: string
}): Promise<void> {
	const { paths } = options
	const id = assertSafeSegment(options.pluginId)
	const target = join(paths.latest.plugins(), id)
	const previousOperation = pending.get(target) ?? Promise.resolve()
	const operation = previousOperation.then(async () => {
		const work = join(paths.local.root, "plugin-transactions", randomUUID())
		const next = join(work, "next")
		const previous = join(work, "previous")
		await mkdir(work, { recursive: true })
		try {
			for await (const _file of walkFiles(options.staging)) {
				/* Validate the complete package before publication. */
			}
			await cp(options.staging, next, {
				recursive: true,
				preserveTimestamps: true,
			})
			const vault = join(target, "vault")
			if (await exists(vault)) {
				for await (const _file of walkFiles(vault)) {
					/* Links must not become shared plugin storage. */
				}
				await cp(vault, join(next, "vault"), {
					recursive: true,
					preserveTimestamps: true,
				})
			}
			await atomicWrite(
				join(work, "pending.json"),
				JSON.stringify({ version: paths.latestVersion, pluginId: id }),
			)
			await mkdir(paths.latest.plugins(), { recursive: true })
			if (await exists(target)) await rename(target, previous)
			await rename(next, target)
		} catch (error) {
			if (!(await exists(target)) && (await exists(previous)))
				await rename(previous, target)
			if ((await exists(target)) || !(await exists(join(work, "pending.json"))))
				await rm(work, { recursive: true, force: true })
			throw error
		}
		// A failed cleanup cannot turn a committed installation into a failed update.
		await rm(work, { recursive: true, force: true }).catch(() => {})
	})
	const settled = operation.catch(() => {})
	pending.set(target, settled)
	try {
		await operation
	} finally {
		if (pending.get(target) === settled) pending.delete(target)
	}
}
