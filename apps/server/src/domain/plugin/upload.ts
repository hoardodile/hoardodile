import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { pluginManifest as pluginManifestSchema } from "@hoardodile/sdk-types/schema"
import { invalid } from "@hoardodile/shared"

export type PluginUploads = {
	readonly installFromZip: (
		archive: NodeJS.ReadableStream,
		opts?: {
			readonly expectedId?: string
			/**
			 * Allowed container formats, sniffed from magic bytes. The
			 * marketplace channel stays zip-only (its release assets are
			 * packed zips); the manual upload path passes the full set.
			 */
			readonly formats?: readonly ContainerFormat[]
		},
	) => Promise<string>
}

export type PluginUploadsDeps = {
	/**
	 * Host-only directory for the extract-then-rename staging folder.
	 * Must not live under `versions/` — leftover `.staging-*` dirs must
	 * never enter the sync tree.
	 */
	readonly stagingRoot: string
	/**
	 * Move a validated extract directory to `versions/<latest>/plugins/<id>`.
	 * Injected so the HTTP layer can wrap the write in `writeVersioned`.
	 */
	readonly commit: (stagingDir: string, id: string) => Promise<void>
	/**
	 * Archive extraction, injected by the assembly site so this module
	 * does not depend on the res domain's archive utilities. Plugin
	 * installs pass a format allow-list — the marketplace channel only
	 * ever accepts zips, while manual uploads admit every format the
	 * extractor supports.
	 */
	readonly extractArchive: (
		source: NodeJS.ReadableStream,
		destDir: string,
		opts: {
			readonly maxBytes: number
			readonly formats?: readonly ContainerFormat[]
		},
	) => Promise<void>
	/**
	 * Cumulative uncompressed byte budget for one plugin archive. Defends
	 * against zip bombs; sized via `PLUGIN_UPLOAD_MAX_BYTES`.
	 */
	readonly maxExtractedBytes: number
}

/** Container formats the plugin upload admit-list supports. */
export type ContainerFormat = "zip" | "tar" | "7z" | "rar" | "xz" | "gzip"

export function buildPluginUploads(deps: PluginUploadsDeps): PluginUploads {
	const { stagingRoot, commit, extractArchive, maxExtractedBytes } = deps

	async function installFromZip(
		archive: NodeJS.ReadableStream,
		opts?: {
			readonly expectedId?: string
			readonly formats?: readonly ContainerFormat[]
		},
	): Promise<string> {
		const stagingId = randomUUID()
		const stagingDir = join(stagingRoot, `plugin-extract-${stagingId}`)

		try {
			await mkdir(stagingDir, { recursive: true })

			// The plugin package channel allows zips by default (and the
			// CLI publish artifact is a zip); a caller may admit the other
			// sniffed formats explicitly (the manual upload path).
			await extractArchive(archive, stagingDir, {
				maxBytes: maxExtractedBytes,
				formats: opts?.formats ?? ["zip"],
			})

			const manifestPath = join(stagingDir, "manifest.json")
			if (!existsSync(manifestPath)) {
				throw invalid(
					"plugin.upload_no_manifest",
					"plugin zip must contain a manifest.json at its root",
					{},
				)
			}

			let raw: string
			try {
				raw = readFileSync(manifestPath, "utf-8")
			} catch {
				throw invalid(
					"plugin.upload_manifest_unreadable",
					"cannot read manifest.json",
					{},
				)
			}

			let parsed: unknown
			try {
				parsed = JSON.parse(raw)
			} catch {
				throw invalid(
					"plugin.upload_manifest_invalid_json",
					"manifest.json is not valid JSON",
					{},
				)
			}

			const result = pluginManifestSchema.safeParse(parsed)
			if (!result.success) {
				throw invalid(
					"plugin.upload_manifest_invalid",
					"manifest.json failed validation",
					{ issues: result.error.issues },
				)
			}

			const { id } = result.data

			if (opts?.expectedId !== undefined && id !== opts.expectedId) {
				throw invalid(
					"plugin.upload_manifest_id_mismatch",
					"plugin zip manifest id does not match the expected plugin id",
					{ expected: opts.expectedId, actual: id },
				)
			}

			const symlink = await findSymlinkEntry(stagingDir)
			if (symlink !== undefined) {
				throw invalid(
					"plugin.upload_symlink",
					"plugin zip must not contain symbolic links",
					{ path: symlink },
				)
			}

			const reserved = await findReservedEntry(stagingDir, "vault")
			if (reserved) {
				throw invalid(
					"plugin.upload_reserved_entry",
					"plugin zip must not contain a top-level `vault` entry — the plugin asset vault is host-managed",
					{ path: reserved },
				)
			}

			await commit(stagingDir, id)
			return id
		} catch (err) {
			await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
			throw err
		}
	}

	return { installFromZip }
}

/**
 * Move `src` to `dest`. Same-volume `rename` first; `EXDEV` falls back
 * to a recursive copy then delete. On Windows a rename can transiently
 * fail with `EPERM`/`EACCES`/`EBUSY` (AV scans, a just-written file's
 * last handle) — retry with a short backoff before giving up.
 */
export async function moveDir(src: string, dest: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await rename(src, dest)
			return
		} catch (err) {
			if (isExdev(err)) {
				await cp(src, dest, { recursive: true })
				await rm(src, { recursive: true, force: true })
				return
			}
			if (!isTransientRename(err) || attempt >= 9) throw err
			await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
		}
	}
}

/** Retryable Windows rename failures: antivirus / pending handles. */
function isTransientRename(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY")
	)
}

/**
 * Return the first symbolic link under `root`, or `undefined` when the
 * tree contains none. A plugin's sandbox fs-read grant is prefix-based on
 * its own directory; a symlink inside that directory could alias an
 * outside path, so installs reject them up front.
 */
export async function findSymlinkEntry(
	root: string,
): Promise<string | undefined> {
	const entries = await readdir(root, { withFileTypes: true })
	for (const entry of entries) {
		const path = join(root, entry.name)
		if (entry.isSymbolicLink()) return path
		if (entry.isDirectory()) {
			const nested = await findSymlinkEntry(path)
			if (nested !== undefined) return nested
		}
	}
	return undefined
}

/**
 * Return the first top-level entry named `name`, or `undefined`. Used to
 * reject host-reserved entry names (the plugin asset vault) — a shipped
 * `vault/` would mix plugin files with host-managed download storage.
 */
export async function findReservedEntry(
	root: string,
	name: string,
): Promise<string | undefined> {
	const entries = await readdir(root, { withFileTypes: true })
	for (const entry of entries) {
		if (entry.name === name) return entry.name
	}
	return undefined
}

function isExdev(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		err.code === "EXDEV"
	)
}
