import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Content hash over a directory tree: sorted relative paths + file bytes
 * (no mtime/uid), so the same code yields the same hash everywhere.
 * `excludePrefixes` skips entries whose relative path equals a prefix or
 * starts with `<prefix>/` — layer identities (server-dist must not
 * include server/node_modules) and the shell bundle hash both use it.
 * `excludeExtensions` skips files whose relative path ends with one of the
 * given extensions (used to keep sourcemaps out of the shell hash: `.map`
 * bytes churn with every bundled dependency and never affect runtime).
 *
 * MUST stay byte-identical with the build-side hasher
 * (scripts/lib/shell-hash.mjs) — change both together.
 */
export function contentHashTree(
	rootDir: string,
	options: {
		readonly excludePrefixes?: readonly string[]
		readonly excludeExtensions?: readonly string[]
	} = {},
): string {
	const excludes = options.excludePrefixes ?? []
	const excludedExtensions = options.excludeExtensions ?? []
	const hash = createHash("sha256")

	function isExcluded(relPath: string): boolean {
		for (const prefix of excludes) {
			if (relPath === prefix || relPath.startsWith(`${prefix}/`)) return true
		}
		return false
	}

	function isExcludedFile(relPath: string): boolean {
		for (const ext of excludedExtensions) {
			if (relPath.endsWith(ext)) return true
		}
		return false
	}

	function walk(dir: string, rel: string): void {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		)
		for (const entry of entries) {
			const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`
			if (isExcluded(relPath)) continue
			const full = join(dir, entry.name)
			if (entry.isDirectory()) {
				hash.update(`${relPath}/\0`)
				walk(full, relPath)
			} else if (entry.isFile()) {
				if (isExcludedFile(relPath)) continue
				hash.update(`${relPath}\0`)
				hash.update(readFileSync(full))
			} else {
				throw new Error(
					`unsupported entry type in shell tree (symlink?): ${full}`,
				)
			}
		}
	}

	if (!existsSync(rootDir)) {
		throw new Error(`missing shell tree root: ${rootDir}`)
	}
	walk(rootDir, "")
	return `sha256:${hash.digest("hex")}`
}

/**
 * Hash of the current shell bundle as installed: the release manifest's
 * `shellHash` is computed over `out/**` at build time, and Electron's
 * asar-transparent fs reads the packaged asar as the same directory
 * tree — identical inputs, identical hash. Only the shell **runtime**
 * boundary is counted: `out/wizard` (a content page, not the shell) and
 * `*.map` (never affect runtime) are excluded, so bundling churn there
 * never misroutes a content-only release to the full channel. Returns
 * `undefined` when the layout is not a packaged asar (dev runs never use
 * the resource channel).
 */
export function installedShellHash(outRoot?: string): string | undefined {
	const root = outRoot ?? join(process.resourcesPath, "app.asar", "out")
	if (!existsSync(join(root, "main", "index.js"))) return undefined
	return contentHashTree(root, {
		excludePrefixes: ["wizard"],
		excludeExtensions: [".map"],
	})
}
