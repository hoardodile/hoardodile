import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises"
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
	createRepositoryLocks,
	isMissing,
	type Repository,
	readJsonState,
	sha256File,
} from "@hoardodile/backup"
import { MIN_PASSWORD_LENGTH } from "@hoardodile/schemas/auth"
import { z } from "zod"

export const backupPassword = z
	.string()
	.min(MIN_PASSWORD_LENGTH)
	.max(4096)
	.refine(
		(value) => !/[\r\n\0]/.test(value),
		"Use a single-line backup password",
	)
export const repositoryCredential = z.string().min(1).max(4096)
const entrySchema = z.object({
	id: z.uuid(),
	path: z.string(),
	identity: z.string(),
	restoreOnly: z.boolean(),
	passwordPending: z.boolean().optional(),
})
type Entry = z.infer<typeof entrySchema>
const registrySchema = z.object({
	activeId: z.uuid().nullable(),
	entries: z.array(entrySchema),
})

export async function physicalPath(path: string): Promise<string> {
	let current = resolve(path)
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
export function pathsOverlap(a: string, b: string): boolean {
	const contains = (parent: string, child: string) => {
		const path = relative(parent, child)
		return (
			path === "" ||
			(!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
		)
	}
	return contains(a, b) || contains(b, a)
}

export function parseCredential(value: string): string {
	if (value.trim().startsWith("{"))
		return z
			.object({
				format: z.literal("hoardodile-restic-v1"),
				key: repositoryCredential,
			})
			.parse(JSON.parse(value)).key
	return repositoryCredential
		.refine((key) => !/[\r\n\0]/.test(key))
		.parse(value)
}

/** Only the desktop's token-gated folder picker can register arbitrary paths. */
export async function createDesktopRepositories(options: {
	directory: string
	storageRoot: string
	protectedPaths: string[]
	engine: BackupEngine
}) {
	const statePath = join(options.directory, "repositories.json")
	const state = await readJsonState(statePath, registrySchema, () => ({
		activeId: null,
		entries: [],
	}))
	const selections = new Map<
		string,
		{
			path: string
			exists: boolean
			identity?: string
			purpose: "restore" | "backup"
			expires: number
		}
	>()
	let writes: Promise<void> = Promise.resolve()
	const persist = () => {
		const content = JSON.stringify(state)
		writes = writes.catch(() => {}).then(() => atomicWrite(statePath, content))
		return writes
	}
	const connections = createRepositoryLocks()
	const keyPath = (id: string) => join(options.directory, "keys", id)
	const descriptor = (entry: Entry): Repository => ({
		id: entry.id,
		path: entry.path,
		passwordFile: keyPath(entry.id),
	})
	const active = () =>
		state.entries.find((entry) => entry.id === state.activeId)
	async function validatePath(path: string) {
		if (!isAbsolute(path))
			throw new BackupError(
				"invalid_repository_path",
				"Choose an absolute backup folder",
			)
		const canonical = await physicalPath(path)
		const root = await physicalPath(options.storageRoot)
		const relation = relative(root, canonical)
		if (
			pathsOverlap(canonical, root) &&
			(relation === "" ||
				relation === ".." ||
				relation.startsWith(`..${sep}`) ||
				isAbsolute(relation))
		)
			throw new BackupError(
				"invalid_repository_path",
				"The backup folder cannot contain the library",
			)
		for (const protectedPath of options.protectedPaths)
			if (pathsOverlap(canonical, await physicalPath(protectedPath)))
				throw new BackupError(
					"invalid_repository_path",
					"The backup folder overlaps library files or a recovery drill folder",
				)
		return canonical
	}
	async function identity(repo: Repository, expected?: string) {
		const canonical = await validatePath(repo.path)
		if (expected && canonical !== repo.path)
			throw new BackupError(
				"restore_source_changed",
				"The backup folder changed",
			)
		let value: string
		try {
			value = await sha256File(join(repo.path, "config"))
		} catch (error) {
			if (!isMissing(error)) throw error
			throw new BackupError(
				"repository_offline",
				"The backup folder is unavailable",
			)
		}
		if (expected && value !== expected)
			throw new BackupError(
				"restore_source_changed",
				"The backup repository changed; choose it again",
			)
		return value
	}
	async function select(path: string, purpose: "restore" | "backup") {
		for (const [id, selection] of selections)
			if (selection.expires < Date.now()) selections.delete(id)
		let canonical = await validatePath(path)
		const hasConfig = async (folder: string) =>
			stat(join(folder, "config"))
				.then((info) => info.isFile())
				.catch((error) => {
					if (isMissing(error)) return false
					throw error
				})
		if (
			!(await hasConfig(canonical)) &&
			(await hasConfig(join(canonical, "local")))
		)
			canonical = await validatePath(join(canonical, "local"))
		const exists = await hasConfig(canonical)
		if (
			state.entries.some(
				(entry) =>
					entry.path !== canonical && pathsOverlap(entry.path, canonical),
			)
		)
			throw new BackupError(
				"invalid_repository_path",
				"Backup repositories must not overlap",
			)
		if (!exists && purpose === "restore")
			throw new BackupError(
				"repository_not_found",
				"No backup repository was found in this folder",
			)
		if (!exists && (await readdir(canonical)).length)
			throw new BackupError(
				"repository_folder_not_empty",
				"Choose an empty folder or an existing backup repository",
			)
		const id = randomUUID()
		const hash = exists
			? await sha256File(join(canonical, "config"))
			: undefined
		selections.set(id, {
			path: canonical,
			exists,
			identity: hash,
			purpose,
			expires: Date.now() + 15 * 60_000,
		})
		const pending = state.entries.some(
			(entry) =>
				entry.path === canonical &&
				entry.identity === hash &&
				entry.passwordPending,
		)
		return { id, path: canonical, exists: exists && !pending, purpose }
	}
	async function connect(input: {
		selectionId: string
		purpose: "restore" | "backup"
		credential?: string
		credentialType?: "password" | "key"
		password?: string
	}) {
		const selection = selections.get(input.selectionId)
		if (
			!selection ||
			selection.purpose !== input.purpose ||
			selection.expires < Date.now()
		)
			throw new BackupError(
				"selection_expired",
				"Choose the backup folder again",
			)
		if ((await validatePath(selection.path)) !== selection.path)
			throw new BackupError(
				"restore_source_changed",
				"The selected folder changed",
			)
		const previous = state.entries.find(
			(entry) =>
				entry.path === selection.path &&
				entry.identity === selection.identity &&
				!entry.restoreOnly,
		)
		const wasPending = Boolean(previous?.passwordPending)
		const id =
			input.purpose === "backup" && previous ? previous.id : randomUUID()
		const repo: Repository = {
			id,
			path: selection.path,
			passwordFile: keyPath(id),
		}
		const candidate = keyPath(`candidate-${randomUUID()}`)
		let created = false
		try {
			if (selection.exists) {
				await identity(repo, selection.identity)
				if (input.credential && !wasPending)
					await atomicWrite(
						candidate,
						input.credentialType === "key"
							? parseCredential(input.credential)
							: repositoryCredential
									.refine((value) => !/[\r\n\0]/.test(value))
									.parse(input.credential),
					)
				else if (previous)
					await atomicWrite(
						candidate,
						await readFile(keyPath(previous.id), "utf8"),
					)
				else
					throw new BackupError(
						"recovery_key_required",
						"Enter the backup password or recovery key",
					)
				await options.engine.checkRepository({
					...repo,
					passwordFile: candidate,
				})
			} else {
				backupPassword.parse(input.password)
				if ((await readdir(repo.path)).length)
					throw new BackupError(
						"restore_source_changed",
						"The selected folder is no longer empty",
					)
				await atomicWrite(candidate, randomBytes(32).toString("base64url"))
				await options.engine.initializeRepository({
					...repo,
					passwordFile: candidate,
				})
				created = true
			}
			const hash = await identity(repo, selection.identity)
			selection.exists = true
			selection.identity = hash
			const entry: Entry = {
				id,
				path: repo.path,
				identity: hash,
				restoreOnly: input.purpose === "restore",
				passwordPending: created || previous?.passwordPending,
			}
			let keepExistingKey = Boolean(previous && input.purpose === "backup")
			if (keepExistingKey) {
				try {
					await options.engine.checkRepository(repo)
				} catch {
					keepExistingKey = false
				}
			}
			if (!keepExistingKey)
				await atomicWrite(repo.passwordFile, await readFile(candidate, "utf8"))
			if (!previous || input.purpose === "restore") state.entries.push(entry)
			else Object.assign(previous, entry)
			// Preserve the random key if adding the user password is interrupted.
			await persist()
			if (entry.passwordPending) {
				backupPassword.parse(input.password)
				await atomicWrite(candidate, input.password ?? "")
				await options.engine.addPassword(repo, candidate)
				await options.engine.checkRepository({
					...repo,
					passwordFile: candidate,
				})
				entry.passwordPending = false
				if (previous) previous.passwordPending = false
				await persist()
			}
			selections.delete(input.selectionId)
			return { entry, created: created || wasPending }
		} finally {
			await rm(candidate, { force: true })
		}
	}
	return {
		select,
		connect: (input: Parameters<typeof connect>[0]) =>
			connections.run("connection", () => connect(input)),
		identity,
		async cleanupCandidates() {
			if (connections.busy("connection")) return
			const directory = join(options.directory, "keys")
			const names = await readdir(directory).catch((error) => {
				if (isMissing(error)) return []
				throw error
			})
			for (const name of names)
				if (/^candidate-[a-f0-9-]{36}(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name))
					await rm(join(directory, name), { force: true })
		},
		descriptor,
		active: () => {
			const entry = active()
			return entry ? descriptor(entry) : undefined
		},
		activeIdentity: () => active()?.identity,
		sources: () =>
			state.entries
				.filter((entry) => entry.restoreOnly)
				.map((entry) => ({
					id: entry.id,
					name: basename(entry.path),
					path: entry.path,
					restoreOnly: true,
					lastContentCheckAt: null,
				})),
		get: (id: string) => {
			const entry = state.entries.find((entry) => entry.id === id)
			return entry ? descriptor(entry) : undefined
		},
		expectedIdentity: (id: string) =>
			state.entries.find((entry) => entry.id === id)?.identity,
		async activate(id: string | null) {
			const previous = state.activeId
			state.activeId = id
			try {
				await persist()
			} catch (error) {
				state.activeId = previous
				throw error
			}
		},
		async release(id: string) {
			const entry = state.entries.find(
				(entry) => entry.id === id && entry.restoreOnly,
			)
			if (!entry) return
			state.entries = state.entries.filter((item) => item !== entry)
			await persist()
			await rm(keyPath(id), { force: true })
		},
		async selectDefault(path: string) {
			await mkdir(path, { recursive: true })
			return select(path, "backup")
		},
	}
}
