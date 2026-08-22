import {
	type PluginManifest,
	pluginManifest,
} from "@hoardodile/sdk-types/schema"
import { unzipSync } from "fflate"

/**
 * Reads and validates `manifest.json` from a plugin zip, without
 * installing anything. Used to show the install confirmation dialog
 * (name, version, declared permissions) before the package is sent to
 * the server. The server re-validates everything on install; this is
 * only a pre-flight preview, so any failure aborts the upload.
 *
 * @throws when the file is not a zip, has no root `manifest.json`, or
 *   the manifest fails schema validation.
 */
export async function readPluginZipManifest(
	file: File,
): Promise<PluginManifest> {
	const data = new Uint8Array(await file.arrayBuffer())
	let entries: ReturnType<typeof unzipSync>
	try {
		entries = unzipSync(data, {
			filter: (entry) => entry.name === "manifest.json",
		})
	} catch (err) {
		throw new Error("not a zip archive", { cause: err })
	}
	const manifestBytes = entries["manifest.json"]
	if (manifestBytes === undefined) {
		throw new Error("manifest.json missing at zip root")
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(new TextDecoder().decode(manifestBytes))
	} catch (err) {
		throw new Error("manifest.json is not valid JSON", { cause: err })
	}
	const result = pluginManifest.safeParse(parsed)
	if (!result.success) {
		throw new Error("manifest.json failed validation", {
			cause: result.error,
		})
	}
	return result.data
}
