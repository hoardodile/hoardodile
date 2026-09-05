import {
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	statfs,
	writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { currentVersion, writeActiveVersion } from "./version.ts"

type Publication = { previous: number; created: number }

function parsePublication(value: unknown): Publication {
	if (
		!value ||
		typeof value !== "object" ||
		!("previous" in value) ||
		!("created" in value) ||
		typeof value.previous !== "number" ||
		typeof value.created !== "number" ||
		!Number.isSafeInteger(value.previous) ||
		value.previous < 1 ||
		value.created !== value.previous + 1
	) {
		throw new Error("Invalid archive publication journal")
	}
	return { previous: value.previous, created: value.created }
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path)
		return true
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return false
		throw error
	}
}

async function verifyPlainTree(root: string): Promise<number> {
	const info = await lstat(root)
	if (
		info.isSymbolicLink() ||
		(!info.isDirectory() && !info.isFile()) ||
		(info.isFile() && info.nlink > 1)
	)
		throw new Error(
			"Archive plugins must contain only independent files and directories",
		)
	let bytes = info.isFile() ? info.size : 0
	if (info.isDirectory())
		for (const name of await readdir(root))
			bytes += await verifyPlainTree(join(root, name))
	return bytes
}

/** Complete a prepared publication before selecting the latest archive at startup. */
export async function recoverVersionPublication(root: string): Promise<void> {
	const work = join(root, "local", "archive-publication")
	const marker = join(work, "pending.json")
	if (!(await exists(marker))) return
	const publication = parsePublication(
		JSON.parse(await readFile(marker, "utf8")),
	)
	const previousDb = join(
		root,
		"versions",
		String(publication.previous),
		"app.sqlite",
	)
	const next = join(root, "versions", String(publication.created))
	if ((await exists(next)) && (await exists(join(work, "next"))))
		throw new Error(
			"The archive destination appeared before publication completed",
		)
	if ((await exists(previousDb)) && (await exists(join(work, "app.sqlite"))))
		throw new Error(
			"The archive database appeared before publication completed",
		)
	if (!(await exists(previousDb)))
		await rename(join(work, "app.sqlite"), previousDb)
	if (!(await exists(next))) await rename(join(work, "next"), next)
	writeActiveVersion(root, publication.created)
	await rm(work, { recursive: true, force: true })
}

/** Build independent plugin copies before publishing the next numeric directory. */
export async function publishVersion(options: {
	root: string
	snapshot: (destination: string) => Promise<void>
	onProgress?: (value: {
		pluginId?: string
		bytes_done: number
		total_bytes: number
	}) => void
	signal?: AbortSignal
}): Promise<Publication> {
	await recoverVersionPublication(options.root)
	options.signal?.throwIfAborted()
	const previous = currentVersion(options.root)
	if (!previous) throw new Error("The storage root is not initialized")
	const publication = { previous, created: previous + 1 }
	const source = join(options.root, "versions", String(previous))
	if (await exists(join(source, "app.sqlite")))
		throw new Error("The current archive is already frozen")
	const work = join(options.root, "local", "archive-publication")
	await rm(work, { recursive: true, force: true })
	const next = join(work, "next")
	await mkdir(next, { recursive: true })
	try {
		const plugins = join(source, "plugins")
		if (await exists(plugins)) {
			const total = await verifyPlainTree(plugins)
			const disk = await statfs(work)
			if (disk.bavail * disk.bsize < total + 64 * 1024 * 1024)
				throw new Error(
					"There is insufficient space for independent plugin copies",
				)
			let copied = 0
			options.onProgress?.({ bytes_done: 0, total_bytes: total })
			for (const name of await readdir(plugins)) {
				options.signal?.throwIfAborted()
				const size = await verifyPlainTree(join(plugins, name))
				await cp(join(plugins, name), join(next, "plugins", name), {
					recursive: true,
					preserveTimestamps: true,
				})
				copied += size
				options.onProgress?.({
					pluginId: name,
					bytes_done: copied,
					total_bytes: total,
				})
			}
		}
		await options.snapshot(join(work, "app.sqlite"))
		options.signal?.throwIfAborted()
		await writeFile(
			join(work, "pending.next.json"),
			JSON.stringify(publication),
			{ mode: 0o600, flush: true },
		)
		await rename(join(work, "pending.next.json"), join(work, "pending.json"))
		await recoverVersionPublication(options.root)
		return publication
	} catch (error) {
		if (await exists(join(work, "pending.json"))) {
			await recoverVersionPublication(options.root)
			return publication
		}
		await rm(work, { recursive: true, force: true })
		throw error
	}
}
