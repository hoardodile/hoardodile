import { createHash } from "node:crypto"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs"
import { join } from "node:path"
import type { PluginManifest } from "@hoardodile/sdk-types"

/**
 * Copy the configured plugin directories into `pluginsDir` so discovery
 * can load them as installed disk plugins. Each source is itself a plugin
 * directory (`manifest.json` at its root). A seed replaces
 * `pluginsDir/<manifest.id>` only when the file set, sizes, or content
 * hashes differ — identical trees are left untouched so a boot does not
 * dirty a synced `versions/` tree.
 */
export function seedPlugins(
	pluginsDir: string,
	seedPluginDirs: readonly string[] | undefined,
): void {
	if (seedPluginDirs === undefined || seedPluginDirs.length === 0) {
		return
	}

	for (const dir of seedPluginDirs) {
		try {
			copyPluginDir(dir, pluginsDir)
		} catch (err) {
			// A locked directory (e.g. a plugin watch rebuilding dist on
			// Windows) must not abort the whole load — the plugin simply
			// stays as-is or surfaces as missing.
			console.warn(
				`[plugin-loader] failed to seed plugin dir ${dir}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}
}

/**
 * Copy a single plugin directory into `pluginsDir/<manifest.id>`.
 * Returns false (and copies nothing) when the directory is not a valid
 * plugin. An existing destination that already matches the source tree
 * is left untouched.
 */
function copyPluginDir(srcDir: string, pluginsDir: string): boolean {
	const id = readManifestId(srcDir)
	if (id === undefined) return false
	const dstDir = join(pluginsDir, id)
	if (existsSync(dstDir) && treesMatch(srcDir, dstDir)) {
		return true
	}
	if (existsSync(dstDir)) {
		rmSync(dstDir, { recursive: true, force: true })
	}
	mkdirSync(dstDir, { recursive: true })
	for (const f of readdirSync(srcDir)) {
		cpSync(join(srcDir, f), join(dstDir, f), { recursive: true })
	}
	return true
}

function readManifestId(dir: string): string | undefined {
	const manifestPath = join(dir, "manifest.json")
	if (!existsSync(manifestPath)) return undefined
	let manifest: PluginManifest
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
	} catch {
		return undefined
	}
	if (typeof manifest.id !== "string" || manifest.id.length === 0) {
		return undefined
	}
	return manifest.id
}

/**
 * True when both directories contain the same relative file set, each
 * with matching byte size and sha256. Directories that do not exist are
 * unequal unless both are missing. Comparison ignores mtime so a copy
 * does not look like a change on the next boot.
 */
function treesMatch(a: string, b: string): boolean {
	const left = fingerprintTree(a)
	const right = fingerprintTree(b)
	if (left.size !== right.size) return false
	for (const [path, fingerprint] of left) {
		if (right.get(path) !== fingerprint) return false
	}
	return true
}

function fingerprintTree(root: string): Map<string, string> {
	const out = new Map<string, string>()
	if (!existsSync(root)) return out
	walkFiles(root, "", out)
	return out
}

function walkFiles(
	absDir: string,
	relDir: string,
	out: Map<string, string>,
): void {
	const entries = readdirSync(absDir, { withFileTypes: true })
	for (const entry of entries) {
		const rel = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`
		const abs = join(absDir, entry.name)
		if (entry.isDirectory()) {
			walkFiles(abs, rel, out)
			continue
		}
		if (!entry.isFile()) continue
		const st = statSync(abs)
		const hash = createHash("sha256").update(readFileSync(abs)).digest("hex")
		out.set(rel.replaceAll("\\", "/"), `${st.size}:${hash}`)
	}
}
