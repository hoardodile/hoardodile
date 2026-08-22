import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { cp, mkdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { pluginManifest as pluginManifestSchema } from "@hoardodile/sdk-types/schema"
import { invalid } from "@hoardodile/shared"

export type PluginUploads = {
	readonly installFromZip: (archive: NodeJS.ReadableStream) => Promise<string>
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
	 * does not depend on the res domain's archive utilities.
	 */
	readonly extractArchive: (
		source: NodeJS.ReadableStream,
		destDir: string,
		opts: { readonly maxBytes: number },
	) => Promise<void>
	/**
	 * Cumulative uncompressed byte budget for one plugin archive. Defends
	 * against zip bombs; sized via `PLUGIN_UPLOAD_MAX_BYTES`.
	 */
	readonly maxExtractedBytes: number
}

export function buildPluginUploads(deps: PluginUploadsDeps): PluginUploads {
	const { stagingRoot, commit, extractArchive, maxExtractedBytes } = deps

	async function installFromZip(
		archive: NodeJS.ReadableStream,
	): Promise<string> {
		const stagingId = randomUUID()
		const stagingDir = join(stagingRoot, `plugin-extract-${stagingId}`)

		try {
			await mkdir(stagingDir, { recursive: true })

			await extractArchive(archive, stagingDir, { maxBytes: maxExtractedBytes })

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
 * to a recursive copy then delete.
 */
export async function moveDir(src: string, dest: string): Promise<void> {
	try {
		await rename(src, dest)
	} catch (err) {
		if (!isExdev(err)) throw err
		await cp(src, dest, { recursive: true })
		await rm(src, { recursive: true, force: true })
	}
}

function isExdev(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		err.code === "EXDEV"
	)
}
