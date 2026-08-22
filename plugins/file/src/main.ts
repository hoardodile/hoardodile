import type { ResourceAPI } from "@hoardodile/sdk-server"
import { definePlugin } from "@hoardodile/sdk-server"
import { countSourceMeta, extname } from "@hoardodile/sdk-server/helpers"
import { PLUGIN_STAT_CONCURRENCY } from "@hoardodile/sdk-types/plugin"
import type { FileEntry, FileSchema } from "./shared"

export default definePlugin<FileSchema>({
	detect: async () => ({ ok: true }) as const,
	sourceMeta: countSourceMeta,
	listFiles,
})

/**
 * Enumerate the resource's files. Archive files (zip/tar) at the top
 * level are expanded one level: their inner entries are listed as
 * `archive!inner` virtual paths, so the built-in file tree keeps
 * browsing archive uploads without any storage-layer help. Hosts
 * without container support (folder import, CLI) fall back to the
 * top-level list.
 */
async function listFiles(api: ResourceAPI): Promise<readonly FileEntry[]> {
	// Keep the container's canonical order (`.order` upload order,
	// natural name sort as fallback) so the tree matches the sequence
	// the user built at upload time.
	const topLevel = await api.listFileNames()
	const expanded: string[] = []
	for (const filename of topLevel) {
		let listing:
			| { readonly entries: readonly { readonly path: string }[] }
			| undefined
		try {
			listing = await api.listContainer(filename)
		} catch {
			// Host without container support — treat as a plain file.
		}
		if (listing !== undefined && listing.entries.length > 0) {
			expanded.push(
				...listing.entries.map((entry) => `${filename}!${entry.path}`),
			)
		} else {
			expanded.push(filename)
		}
	}
	// One statFiles RPC per chunk instead of a statFile round-trip per
	// entry; the host resolves each chunk in parallel.
	const stats: ({ readonly sizeBytes: number } | undefined)[] = []
	for (let i = 0; i < expanded.length; i += PLUGIN_STAT_CONCURRENCY) {
		const chunk = expanded.slice(i, i + PLUGIN_STAT_CONCURRENCY)
		stats.push(...(await api.statFiles(chunk)))
	}
	return expanded.map((filename, index) => ({
		filename,
		ext: extname(filename) || undefined,
		sizeBytes: stats[index]?.sizeBytes,
	}))
}
