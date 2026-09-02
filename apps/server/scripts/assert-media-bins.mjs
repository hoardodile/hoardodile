/**
 * Assert that ffmpeg/ffprobe/7-Zip installer packages in a dist
 * `node_modules` tree resolve to real binaries. Loads each copied
 * `index.js` by absolute path so Node cannot fall through to the
 * workspace install and green-light a missing copy.
 */
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"

export const OPTIONAL_BIN_PACKAGES = [
	"@hoardodile/ffmpeg-bin",
	"@hoardodile/ffprobe-bin",
	"@hoardodile/7z-bin",
]

/**
 * @param {string} nodeModulesDir
 */
export function assertCopiedMediaBins(nodeModulesDir) {
	const root = resolve(nodeModulesDir)
	for (const pkgName of OPTIONAL_BIN_PACKAGES) {
		const pkgDir = join(root, ...pkgName.split("/"))
		const index = join(pkgDir, "index.js")
		if (!existsSync(index)) {
			throw new Error(`missing ${pkgName} at ${index}`)
		}
		const req = createRequire(index)
		const resolved = req(index)
		const binPath = binPathOf(resolved)
		if (binPath === undefined || !existsSync(binPath)) {
			throw new Error(
				`${pkgName} did not resolve to an existing binary (got ${String(binPath)})`,
			)
		}
	}
}

/**
 * @param {unknown} resolved
 * @returns {string | undefined}
 */
function binPathOf(resolved) {
	if (typeof resolved === "string" && resolved.length > 0) return resolved
	if (
		resolved !== null &&
		typeof resolved === "object" &&
		"path" in resolved &&
		typeof resolved.path === "string" &&
		resolved.path.length > 0
	) {
		return resolved.path
	}
	return undefined
}
