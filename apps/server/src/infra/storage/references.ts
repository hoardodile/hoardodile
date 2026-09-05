import { readdir, stat } from "node:fs/promises"
import { posix } from "node:path"
import { BackupError, confinedPath, isMissing } from "@hoardodile/backup"
import { listVersions } from "@hoardodile/host/hoard"
import { charImageMeta, imageSlotMeta } from "@hoardodile/schemas"
import { openDb, schema } from "src/infra/db/connection.ts"

type ReferenceTree = {
	versions: ReadonlySet<number>
	file: (path: string) => Promise<boolean>
	prefix: (path: string) => Promise<boolean>
}

export function snapshotReferenceTree(
	files: ReadonlySet<string>,
): ReferenceTree {
	const versions = new Set<number>()
	const directories = new Map<string, Set<string>>()
	for (const path of files) {
		const version = Number(path.split("/", 1)[0])
		if (Number.isSafeInteger(version) && version > 0) versions.add(version)
		const directory = posix.dirname(path)
		const names = directories.get(directory) ?? new Set<string>()
		names.add(posix.basename(path))
		directories.set(directory, names)
	}
	return {
		versions,
		file: async (path) => files.has(path),
		prefix: async (path) =>
			[...(directories.get(posix.dirname(path)) ?? [])].some((name) =>
				name.startsWith(posix.basename(path)),
			),
	}
}

export function diskReferenceTree(
	storageRoot: string,
	versionsRoot: string,
): ReferenceTree {
	return {
		versions: new Set(listVersions(storageRoot)),
		file: async (path) => {
			try {
				return (await stat(confinedPath(versionsRoot, path))).isFile()
			} catch (error) {
				if (isMissing(error)) return false
				throw error
			}
		},
		prefix: async (path) => {
			try {
				const directory = confinedPath(versionsRoot, posix.dirname(path))
				return (await readdir(directory, { withFileTypes: true })).some(
					(entry) =>
						entry.isFile() && entry.name.startsWith(posix.basename(path)),
				)
			} catch (error) {
				if (isMissing(error)) return false
				throw error
			}
		},
	}
}

/** Validate authoritative version and permanent-image pointers, not rebuildable file counts. */
export async function verifyDatabaseReferences(options: {
	database: string
	archiveVersion: number
	tree: ReferenceTree
}): Promise<void> {
	const handles = openDb(options.database, { readonly: true })
	const version = (value: number) => {
		if (
			!Number.isSafeInteger(value) ||
			value < 1 ||
			value > options.archiveVersion ||
			!options.tree.versions.has(value)
		) {
			throw new BackupError(
				"missing_archive",
				"The database references an unavailable archive version",
			)
		}
	}
	const image = async (prefix: string) => {
		if (!(await options.tree.prefix(prefix)))
			throw new BackupError(
				"missing_image",
				`A referenced image is missing: ${prefix}`,
			)
	}
	try {
		for (const row of handles.db.select().from(schema.resources).all()) {
			version(row.fileVersion)
			version(row.coverVersion)
		}
		for (const row of handles.db.select().from(schema.characters).all()) {
			version(row.avatarVersion)
			version(row.fullbodyVersion)
			const meta = charImageMeta.safeParse(
				row.imageMeta ? JSON.parse(row.imageMeta) : {},
			)
			if (meta.success) {
				if (meta.data.avatar && "kind" in meta.data.avatar)
					await image(`${row.avatarVersion}/characters/${row.id}/avatar.`)
				if (meta.data.fullbody && "kind" in meta.data.fullbody)
					await image(`${row.fullbodyVersion}/characters/${row.id}/fullbody.`)
			}
		}
		for (const row of handles.db.select().from(schema.tags).all()) {
			version(row.imageVersion)
			const meta = imageSlotMeta.safeParse(
				row.imageMeta ? JSON.parse(row.imageMeta) : undefined,
			)
			if (meta.success && "kind" in meta.data)
				await image(`${row.imageVersion}/tags/${row.id}/image.`)
		}
		for (const row of handles.db.select().from(schema.contentPlugins).all()) {
			if (row.missing) continue
			for (const name of ["manifest.json", "main.js"]) {
				if (
					!(await options.tree.file(
						`${options.archiveVersion}/plugins/${row.id}/${name}`,
					))
				)
					throw new BackupError(
						"missing_plugin",
						`An installed plugin file is missing: ${row.id}/${name}`,
					)
			}
		}
	} finally {
		handles.close()
	}
}
