import type { ResourceContainer } from "@hoardodile/host"

/**
 * Collect size and top-level file count from the source view. With the
 * single-archive storage shape, `listEntries` returns every entry in the
 * artifact (zip entries are flat-listed even when they contain `/` in
 * their names), so a separate recursive walk is no longer needed. Sizes
 * come straight from the process-cached zip central directory — no
 * per-file stat calls.
 *
 * Returns `undefined` when the artifact is not accessible; returns
 * `{ sizeBytes: 0, count: 0 }` for an empty artifact.
 */
export async function aggregateSourceFiles(
	view: Pick<ResourceContainer, "listEntries" | "resolveByteRange">,
): Promise<{ sizeBytes: number; count: number } | undefined> {
	const files = await view.listEntries().catch(() => undefined)
	if (files === undefined) return undefined

	let sizeBytes = 0
	for (const filename of files) {
		try {
			const range = await view.resolveByteRange(filename)
			if (range !== undefined) sizeBytes += range.size
		} catch {
			// Entry unreadable — skip in size aggregation
		}
	}

	return { sizeBytes, count: files.length }
}
