import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Explicit file order for a resource's content root (`data/`). Uploads
 * install entries in the user's chosen order and persist that sequence
 * in this manifest so the display order matches the upload order even
 * when filenames sort differently. Written at commit time; because it
 * lives inside the replaced `data/` subtree it is always consistent
 * with the entries around it.
 *
 * The manifest is a JSON array of relative entry names (`/`-separated),
 * listing the final installed names (after collision suffixing). Reads
 * are strict: a malformed manifest, or one whose entries do not all
 * resolve against the actual listing, is ignored entirely and callers
 * fall back to the natural name sort. Strictness matters because
 * `createDirectoryContainer` also serves arbitrary user directories
 * (folder import, plugin dev) that may coincidentally contain a file
 * named `.order`.
 */
export const ORDER_MANIFEST_NAME = ".order"

/** Path of the order manifest inside a resource content root. */
export function orderManifestPath(dataDir: string): string {
	return join(dataDir, ORDER_MANIFEST_NAME)
}

/**
 * Atomically persist `names` as the manifest of `dataDir` (tmp + rename,
 * so a concurrent reader never observes a half-written file).
 */
export async function writeOrderManifest(
	dataDir: string,
	names: readonly string[],
): Promise<void> {
	const dest = orderManifestPath(dataDir)
	const tmp = `${dest}.writing-${process.pid}-${Date.now()}`
	try {
		await writeFile(tmp, JSON.stringify(names), "utf8")
		await rename(tmp, dest)
	} catch (err) {
		await rm(tmp, { force: true }).catch(() => {})
		throw err
	}
}

/**
 * Read the manifest of `dataDir`. Resolves to `undefined` when the
 * manifest is absent or fails structural validation
 * ({@link parseOrderManifest}) — callers fall back to natural order.
 */
export async function readOrderManifest(
	dataDir: string,
): Promise<readonly string[] | undefined> {
	let raw: string
	try {
		raw = await readFile(orderManifestPath(dataDir), "utf8")
	} catch {
		return undefined
	}
	return parseOrderManifest(raw)
}

/**
 * Structural validation of a raw manifest body: a JSON array of
 * non-empty relative paths with `/` separators that cannot escape the
 * content root. Returns `undefined` when the body is not a usable
 * manifest. Semantic validation (entries exist in the listing) happens
 * in {@link orderEntries}.
 */
export function parseOrderManifest(raw: string): readonly string[] | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return undefined
	}
	if (!Array.isArray(parsed) || parsed.length === 0) return undefined
	const names: string[] = []
	for (const entry of parsed) {
		if (typeof entry !== "string") return undefined
		if (!isManifestPathSafe(entry)) return undefined
		names.push(entry)
	}
	if (names.length === 0) return undefined
	return names
}

/**
 * Reorder `listed` by the manifest: entries named by the manifest come
 * first, in manifest order; entries the manifest does not mention are
 * appended in natural order. Returns `undefined` when the manifest
 * cannot be applied against this listing (some manifest entry is
 * missing — the strict trust rule), so the caller falls back to the
 * natural sort.
 */
export function orderEntries(
	manifest: readonly string[],
	listed: readonly string[],
): readonly string[] | undefined {
	const available = new Set(listed)
	const uniqueManifest = new Set<string>()
	for (const name of manifest) {
		if (uniqueManifest.has(name)) return undefined
		uniqueManifest.add(name)
		if (!available.has(name)) return undefined
	}
	const ordered = manifest.filter((name) => available.has(name))
	const rest = naturalSort(listed.filter((name) => !uniqueManifest.has(name)))
	return [...ordered, ...rest]
}

/** Case-insensitive natural name sort (`1 < 2 < 10`, `a < b`). */
export function naturalSort(names: readonly string[]): readonly string[] {
	return [...names].sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
	)
}

function isManifestPathSafe(entry: string): boolean {
	if (entry.length === 0 || entry.includes("\0") || entry.includes("\\")) {
		return false
	}
	const segments = entry.split("/")
	for (const segment of segments) {
		if (segment.length === 0 || segment === "." || segment === "..") {
			return false
		}
	}
	return true
}
