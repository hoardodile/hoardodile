import { statfs } from "node:fs/promises"

export type VolumeStats = {
	readonly totalBytes: number
	readonly freeBytes: number
}

/**
 * Total/free bytes of the filesystem backing `path` (via `fs.statfs`), or
 * `undefined` when the volume info cannot be read. Shared by the storage
 * overview, the auto-snapshot low-disk guard, and the health endpoint so
 * the volume math lives in exactly one place.
 */
export async function volumeStatsOf(
	path: string,
): Promise<VolumeStats | undefined> {
	try {
		const stats = await statfs(path)
		return {
			totalBytes: stats.blocks * stats.bsize,
			freeBytes: stats.bavail * stats.bsize,
		}
	} catch {
		return undefined
	}
}
