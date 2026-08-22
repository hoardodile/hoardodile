/**
 * Filename hygiene for bare-file resources: map a user-supplied name
 * (upload filename or zip entry name) onto a safe relative path inside
 * a resource folder.
 *
 * Resource folders hold user entries next to metadata dotfiles
 * (`.cover.*`, `.deleted`), so every rule here also guarantees the result
 * can never collide with those: leading dots are stripped, and a
 * trailing-dot/space rule mirrors Windows normalization.
 *
 * Cross-platform guarantees: names are NFC-normalized (macOS stores
 * NFD on disk — one canonical form keeps names stable when a library
 * moves between systems), segments are capped at 240 UTF-8 bytes
 * (ext4's 255-byte component limit, minus suffix headroom), and the
 * Windows reserved-name set includes the device aliases (`CONIN$`,
 * superscript COM/LPT variants).
 *
 * The migration script (`scripts/migrate-hoard-to-files.mjs`) mirrors
 * these rules verbatim — keep both in sync when changing them.
 */

const FORBIDDEN_VISIBLE_CHARS = '<>:"|?*'

/** Max UTF-8 bytes per path segment (ext4 limit 255, suffix headroom). */
const MAX_SEGMENT_BYTES = 240

/** Max characters for the whole relative path. */
const MAX_REL_PATH_CHARS = 700

/** Safety net for the collision-suffix loop in {@link uniqueEntryName}. */
const MAX_UNIQUE_RETRIES = 10_000

/** Windows reserved base names (case-insensitive), incl. device aliases. */
const WINDOWS_RESERVED = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM0",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT0",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
	"CONIN$",
	"CONOUT$",
	"COM\u00b9",
	"COM\u00b2",
	"COM\u00b3",
	"LPT\u00b9",
	"LPT\u00b2",
	"LPT\u00b3",
])

/**
 * Sanitize a single entry name into a safe relative path. Separators
 * (`/` and `\`) become subdirectory boundaries; `..` and absolute paths
 * are rejected. Returns `undefined` when the name is unusable (empty,
 * escapes the folder, or cleans to nothing) — callers drop or reject
 * such entries.
 */
export function sanitizeEntryName(name: string): string | undefined {
	if (name.length === 0 || name.includes("\0")) return undefined
	// One canonical Unicode form so names survive filesystem
	// normalization (macOS NFD) when a library moves between hosts.
	const normalized = name.normalize("NFC")
	const rawSegments = normalized.replace(/\\/g, "/").split("/")
	const segments: string[] = []
	for (const raw of rawSegments) {
		const cleaned = cleanSegment(raw)
		if (cleaned === undefined) continue
		segments.push(cleaned)
	}
	if (segments.length === 0) return undefined
	const relPath = segments.join("/")
	if (relPath.length > MAX_REL_PATH_CHARS) return undefined
	return relPath
}

/** Clean one path segment; `undefined` when it must be dropped entirely. */
function cleanSegment(raw: string): string | undefined {
	if (raw.length === 0 || raw === "." || raw === "..") return undefined
	let out = ""
	for (const ch of raw) {
		const code = ch.codePointAt(0)
		if (code !== undefined && code < 32) continue
		if (FORBIDDEN_VISIBLE_CHARS.includes(ch)) {
			out += "_"
			continue
		}
		out += ch
	}
	// Leading dots would make the entry a dotfile (colliding with the
	// metadata namespace `.cover.*` / `.deleted`); trailing dots and
	// spaces vanish on Windows and would break path equality.
	let trimmed = out.replace(/^\.+/, "").replace(/[. ]+$/, "")
	if (trimmed.length === 0) return undefined
	trimmed = truncateUtf8(trimmed, MAX_SEGMENT_BYTES)
	if (trimmed.length === 0) return undefined
	const base = trimmed.split(".")[0]?.toUpperCase()
	if (base !== undefined && WINDOWS_RESERVED.has(base)) {
		trimmed = `_${trimmed}`
	}
	return trimmed
}

/** Truncate `value` so its UTF-8 length stays within `maxBytes`. */
function truncateUtf8(value: string, maxBytes: number): string {
	let bytes = 0
	let out = ""
	for (const ch of value) {
		const len = Buffer.byteLength(ch, "utf8")
		if (bytes + len > maxBytes) break
		bytes += len
		out += ch
	}
	return out
}

/**
 * Occupancy bookkeeping for name resolution: which paths are already
 * taken by files (blocking everything) and which are directories
 * (blocking only exact-path installs — a file cannot replace a folder).
 */
export type OccupiedNames = {
	readonly files: Set<string>
	readonly dirs: Set<string>
}

/** Build occupancy from optional existing on-disk names (with types). */
export function createOccupiedNames(existing?: {
	readonly files?: Iterable<string>
	readonly dirs?: Iterable<string>
}): OccupiedNames {
	return {
		files: new Set(existing?.files ?? []),
		dirs: new Set(existing?.dirs ?? []),
	}
}

/**
 * Record `relPath` as an installed file; every ancestor prefix becomes
 * a directory. A later entry colliding with one of the ancestors (a
 * file that sits on a directory path) is resolved by
 * {@link uniqueEntryName}.
 */
export function occupyEntryName(
	occupied: OccupiedNames,
	relPath: string,
): void {
	occupied.files.add(relPath)
	let prefix = ""
	for (const segment of relPath.split("/").slice(0, -1)) {
		prefix = prefix.length > 0 ? `${prefix}/${segment}` : segment
		occupied.dirs.add(prefix)
	}
}

/**
 * Resolve a sanitized relative path against the names already present
 * in the target folder by suffixing the colliding segment (`-1`, `-2`,
 * …). The comparison is case-insensitive (Windows and macOS filesystems
 * are). Files block their path and every ancestor prefix; directories
 * block only their exact path. The suffix lands on the segment whose
 * prefix collides, so `x/y.txt` against an occupied file `x` becomes
 * `x-1/y.txt`, not `x/y-1.txt` (which would collide forever).
 */
export function uniqueEntryName(
	occupied: OccupiedNames,
	relPath: string,
): string {
	const lowerFiles = new Set([...occupied.files].map((p) => p.toLowerCase()))
	const lowerDirs = new Set([...occupied.dirs].map((p) => p.toLowerCase()))
	let candidate = relPath
	for (let guard = 0; guard < MAX_UNIQUE_RETRIES; guard += 1) {
		const segIdx = collidingSegment(lowerFiles, lowerDirs, candidate)
		if (segIdx < 0) return candidate
		const segments = candidate.split("/")
		const target = segments[segIdx]!
		const dot = target.lastIndexOf(".")
		const stem = dot > 0 ? target.slice(0, dot) : target
		const ext = dot > 0 ? target.slice(dot) : ""
		for (let i = 1; ; i += 1) {
			const next = `${stem}-${i}${ext}`
			const rebuilt = segments
				.map((seg, idx) => (idx === segIdx ? next : seg))
				.join("/")
			if (collidingSegment(lowerFiles, lowerDirs, rebuilt) < 0) {
				candidate = rebuilt
				break
			}
		}
	}
	throw new Error(`unable to resolve a unique name for ${relPath}`)
}

/**
 * Index of the segment whose path prefix is taken by a FILE, or whose
 * exact path is taken by a file or directory, or `-1`. Directory
 * ancestors are not collisions (nested entries need them).
 */
function collidingSegment(
	lowerFiles: ReadonlySet<string>,
	lowerDirs: ReadonlySet<string>,
	candidate: string,
): number {
	const segments = candidate.split("/")
	const lower = candidate.toLowerCase()
	if (lowerFiles.has(lower) || lowerDirs.has(lower)) return segments.length - 1
	let prefix = ""
	for (let i = 0; i < segments.length - 1; i += 1) {
		prefix = prefix.length > 0 ? `${prefix}/${segments[i]}` : segments[i]!
		if (lowerFiles.has(prefix.toLowerCase())) return i
	}
	return -1
}
