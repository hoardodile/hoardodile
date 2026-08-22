import { readFileSync } from "node:fs"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	computeDHash,
	computePHash,
	grayStddev,
	MIN_PERCEPTUAL_STDDEV,
	PHASH_GRID,
} from "@hoardodile/host"
import { notFound } from "@hoardodile/shared"
import { assertSafeSegment } from "src/infra/storage/paths.ts"
import type { QueryHash } from "./hash-service.ts"

/**
 * Ephemeral storage for reverse-image-search query sessions.
 *
 * Each session is a directory under `{tmp}/image-search/<sessionId>/`
 * holding the uploaded source image plus a `hashes.json` sidecar with
 * the perceptual hashes derived from it. The session survives server
 * restarts (the directory is the state — no memory), and stale sessions
 * are reclaimed by an opportunistic TTL sweep on each new upload, so
 * disk usage stays bounded. This mirrors the staged-upload pool's
 * file-encoded-id layout; nothing here touches `versions/`.
 */

/** One query session's root dir. Throws NOT_FOUND for unknown sessions. */
function sessionDir(tmpBase: string, sessionId: string): string {
	assertSafeSegment(sessionId)
	return join(tmpBase, "image-search", sessionId)
}

function hashesPath(tmpBase: string, sessionId: string): string {
	return join(sessionDir(tmpBase, sessionId), "hashes.json")
}

export type ImageSearchSessionsDeps = {
	readonly tmpBase: string
	readonly decodeGrayGrid: (path: string) => Promise<Uint8Array | undefined>
	readonly newId: () => string
	readonly now: () => number
}

export type ImageSearchSessions = {
	/**
	 * Create an empty session workspace and return the id plus the path
	 * the caller (the upload route) streams the source image into.
	 */
	readonly beginSession: (ext: string) => Promise<{
		sessionId: string
		imagePath: string
	}>
	/**
	 * Decode the session image and persist its perceptual hashes. Returns
	 * `false` (and removes the session) when the image is undecodable or
	 * too flat to hash meaningfully.
	 */
	readonly finalizeSession: (sessionId: string) => Promise<boolean>
	/** The persisted query hashes of a session. Throws NOT_FOUND. */
	readonly loadQueryHashes: (sessionId: string) => readonly QueryHash[]
	/** The session source image, when it still exists. */
	readonly queryImage: (
		sessionId: string,
	) => Promise<{ path: string; ext: string } | undefined>
	/** Remove the session (failed uploads, decode rejects). */
	readonly discard: (sessionId: string) => Promise<void>
	/** Remove every session untouched for longer than `maxAgeMs`. */
	readonly sweep: (maxAgeMs: number) => Promise<void>
}

export function buildImageSearchSessions(
	deps: ImageSearchSessionsDeps,
): ImageSearchSessions {
	const { tmpBase, decodeGrayGrid, newId, now } = deps

	async function beginSession(ext: string) {
		const sessionId = newId()
		const dir = sessionDir(tmpBase, sessionId)
		await mkdir(dir, { recursive: true })
		return { sessionId, imagePath: join(dir, `source${ext}`) }
	}

	async function finalizeSession(sessionId: string): Promise<boolean> {
		const dir = sessionDir(tmpBase, sessionId)
		const name = await readdir(dir)
			.catch(() => [])
			.then((names) => names.find((entry) => entry.startsWith("source")))
		if (name === undefined) {
			await rm(dir, { recursive: true, force: true })
			return false
		}
		let gray: Uint8Array | undefined
		try {
			gray = await decodeGrayGrid(join(dir, name))
		} catch {
			await rm(dir, { recursive: true, force: true })
			return false
		}
		if (gray === undefined) {
			// Undecodable as an image — not a searchable query.
			await rm(dir, { recursive: true, force: true })
			return false
		}
		const hashes: QueryHash[] = []
		if (grayStddev(gray) >= MIN_PERCEPTUAL_STDDEV) {
			hashes.push(
				{ type: "dhash", value: computeDHash(gray, PHASH_GRID) },
				{ type: "phash", value: computePHash(gray, PHASH_GRID) },
			)
		}
		await writeFile(hashesPath(tmpBase, sessionId), JSON.stringify(hashes))
		return true
	}

	function loadQueryHashes(sessionId: string): readonly QueryHash[] {
		let raw: string
		try {
			raw = readFileSync(hashesPath(tmpBase, sessionId), "utf8")
		} catch {
			throw notFound(
				"resource.image_search_session_not_found",
				"image search session not found",
			)
		}
		return JSON.parse(raw) as readonly QueryHash[]
	}

	async function queryImage(
		sessionId: string,
	): Promise<{ path: string; ext: string } | undefined> {
		const dir = sessionDir(tmpBase, sessionId)
		const names = await readdir(dir).catch(() => [])
		const name = names.find((entry) => entry.startsWith("source"))
		if (name === undefined) return undefined
		return { path: join(dir, name), ext: name.slice("source".length) }
	}

	async function sweep(maxAgeMs: number): Promise<void> {
		const root = join(tmpBase, "image-search")
		const cutoff = now() - maxAgeMs
		const names = await readdir(root).catch(() => [])
		for (const name of names) {
			try {
				const { mtimeMs } = await stat(join(root, name))
				if (mtimeMs < cutoff) {
					await rm(join(root, name), { recursive: true, force: true })
				}
			} catch {
				// Concurrently removed or unreadable — best-effort.
			}
		}
	}

	async function discard(sessionId: string): Promise<void> {
		await rm(sessionDir(tmpBase, sessionId), { recursive: true, force: true })
	}

	return {
		beginSession,
		finalizeSession,
		loadQueryHashes,
		queryImage,
		discard,
		sweep,
	}
}
