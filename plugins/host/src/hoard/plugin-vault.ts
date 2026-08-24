/**
 * The plugin asset vault storage primitives: resolving vault-relative
 * destinations (the isolation boundary — a `dest` can never escape the
 * plugin's own vault), reading/statting vault files, removing them, and
 * committing downloaded files atomically.
 *
 * The vault root is `<version>/plugins/<id>/vault` (see
 * {@link VersionPaths.pluginVaultDir}); the primitives operate on an
 * explicit vault directory so the server can pass the `latest` version
 * for writes (inside `writeVersioned`) or the active version for reads.
 *
 * Cost note (deliberate): the vault lives inside the versioned tree, so
 * each archive version snapshots a full copy of it — durability over
 * deduplication, same as `resources/<id>/data/`.
 *
 * Misuse answers {@link PluginAssetError} with `POLICY` so the plugin
 * sees a machine-readable rejection before any network happens.
 */
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pluginAssetError } from "@hoardodile/sdk-types"
import { sumDirSizes } from "./dir-size.ts"
import { assertInside, assertSafeSegment } from "./paths.ts"

/** Thrown when a vault path violates the isolation rules (POLICY). */
export class PluginVaultPathError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PluginVaultPathError"
	}
}

/**
 * Parse a vault-relative destination and resolve it against the vault
 * root. Every segment goes through {@link assertSafeSegment} (no empty
 * segments, `.`/`..`, separators inside a segment, drive letters,
 * control chars, Windows-reserved names, trailing dot/space) and the
 * final path is re-checked with {@link assertInside} — doubly so, the
 * whole point is that a downloaded file can only ever land inside the
 * plugin's own vault.
 */
export function parsePluginVaultDest(
	vaultDir: string,
	dest: string,
): { readonly rel: string; readonly abs: string } {
	if (dest.length === 0) {
		throw new PluginVaultPathError("plugin vault destination must not be empty")
	}
	const segments = dest.split("/")
	let abs = vaultDir
	for (const segment of segments) {
		if (segment.length === 0) {
			throw new PluginVaultPathError(
				`plugin vault destination must not contain empty segments: ${JSON.stringify(dest)}`,
			)
		}
		try {
			abs = join(abs, assertSafeSegment(segment))
		} catch (err) {
			// assertSafeSegment answers plain Errors — the boundary keeps
			// one vocabulary so callers can map them to POLICY uniformly.
			throw new PluginVaultPathError(
				err instanceof Error ? err.message : String(err),
			)
		}
	}
	try {
		const resolved = assertInside(vaultDir, abs)
		return { rel: segments.join("/"), abs: resolved }
	} catch (err) {
		throw new PluginVaultPathError(
			err instanceof Error ? err.message : String(err),
		)
	}
}

/**
 * Byte size of a vault file (or `undefined` when absent or not a
 * regular file). The cheap presence check `download` builds on.
 */
export async function vaultStatFile(
	vaultDir: string,
	rel: string,
): Promise<{ readonly sizeBytes: number } | undefined> {
	const { abs } = parsePluginVaultDest(vaultDir, rel)
	const info = await stat(abs).catch(() => undefined)
	if (info === undefined || !info.isFile()) return undefined
	return { sizeBytes: info.size }
}

/** Stream a vault file's bytes (bounded by `maxBytes`). */
export async function vaultReadFile(
	vaultDir: string,
	rel: string,
	maxBytes: number,
): Promise<Uint8Array> {
	const { abs } = parsePluginVaultDest(vaultDir, rel)
	const info = await stat(abs).catch(() => undefined)
	if (info === undefined || !info.isFile()) {
		throw pluginAssetError("POLICY", `plugin vault file not found: ${rel}`)
	}
	if (info.size > maxBytes) {
		throw pluginAssetError(
			"POLICY",
			`plugin vault file "${rel}" exceeds the ${maxBytes}-byte read cap`,
		)
	}
	const bytes = await readFile(abs)
	return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Remove a vault file. Idempotent (absent → false); directories and
 * anything outside the vault are rejected.
 */
export async function vaultRemoveFile(
	vaultDir: string,
	rel: string,
): Promise<boolean> {
	const { abs } = parsePluginVaultDest(vaultDir, rel)
	const info = await stat(abs).catch(() => undefined)
	if (info === undefined) return false
	if (!info.isFile()) {
		throw pluginAssetError(
			"POLICY",
			`plugin vault destination is not a file: ${rel}`,
		)
	}
	await rm(abs)
	return true
}

/**
 * Path of the caller's download temp file inside the vault (host-side
 * staging — never a user-visible name). The downloader streams into it;
 * {@link commitVaultFile} renames it into place.
 */
export function vaultTempFile(vaultDir: string): string {
	return join(vaultDir, `.${randomUUID()}.tmp`)
}

/** Delete a temp file (download failure path). */
export async function discardVaultTempFile(tempPath: string): Promise<void> {
	await rm(tempPath, { force: true }).catch(() => {})
}

/**
 * Commit a downloaded temp file into the vault: mkdir the nested
 * destination, verify the per-plugin total-size budget (the destination's
 * own previous bytes count against the quota only once — re-downloading
 * replaces, it does not add), then rename the temp file into place
 * (atomic — the final path never holds a partial download).
 */
export async function commitVaultFile(opts: {
	readonly vaultDir: string
	readonly rel: string
	readonly tempPath: string
	readonly maxFileBytes: number
	readonly maxTotalBytes: number
}): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
	const { abs } = parsePluginVaultDest(opts.vaultDir, opts.rel)
	const existing = await stat(abs).catch(() => undefined)
	if (existing !== undefined && !existing.isFile()) {
		throw pluginAssetError(
			"POLICY",
			`plugin vault destination is not a file: ${opts.rel}`,
		)
	}
	const tempInfo = await stat(opts.tempPath).catch(() => undefined)
	if (tempInfo === undefined || !tempInfo.isFile()) {
		throw pluginAssetError(
			"POLICY",
			`plugin vault download lost its staging file: ${opts.rel}`,
		)
	}
	if (tempInfo.size > opts.maxFileBytes) {
		throw pluginAssetError(
			"POLICY",
			`plugin vault file "${opts.rel}" exceeds the ${opts.maxFileBytes}-byte download cap`,
		)
	}
	const currentTotal = await vaultTotalSize(opts.vaultDir)
	const replacedBytes = existing?.isFile() ? existing.size : 0
	if (currentTotal - replacedBytes + tempInfo.size > opts.maxTotalBytes) {
		throw pluginAssetError(
			"POLICY",
			`plugin vault "${opts.rel}" would exceed the ${opts.maxTotalBytes}-byte plugin quota (current ${currentTotal})`,
		)
	}
	await mkdir(resolve(abs, ".."), { recursive: true })
	await rename(opts.tempPath, abs)
	return { sizeBytes: tempInfo.size, sha256: await hashFileAbs(abs) }
}

/**
 * Total bytes of the vault's regular files (shared directory-size walk;
 * host temp staging files — leading `.` — are excluded as transient).
 */
export async function vaultTotalSize(vaultDir: string): Promise<number> {
	return sumDirSizes(vaultDir, { excludeDotPrefix: true })
}

/** sha256 of a vault file's bytes (streamed; callers verify pins against it). */
export async function vaultFileSha256(
	vaultDir: string,
	rel: string,
): Promise<string> {
	const { abs } = parsePluginVaultDest(vaultDir, rel)
	const info = await stat(abs).catch(() => undefined)
	if (info === undefined || !info.isFile()) {
		throw pluginAssetError("POLICY", `plugin vault file not found: ${rel}`)
	}
	return hashFileAbs(abs)
}

async function hashFileAbs(abs: string): Promise<string> {
	const hash = createHash("sha256")
	await new Promise<void>((resolveDone, reject) => {
		const stream = createReadStream(abs)
		stream.on("data", (chunk: string | Buffer) => hash.update(chunk))
		stream.on("end", () => resolveDone())
		stream.on("error", reject)
	})
	return hash.digest("hex")
}

/** Result of {@link commitVaultFile}: the stored file's identity. */
export type VaultCommitResult = {
	readonly sizeBytes: number
	readonly sha256: string
}
