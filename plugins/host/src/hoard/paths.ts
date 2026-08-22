import { createHash } from "node:crypto"
import { isAbsolute, resolve, sep } from "node:path"
import {
	currentVersion as diskCurrentVersion,
	readActiveVersion,
} from "./version.ts"

/**
 * Windows reserved base names (case-insensitive). These must not appear as
 * the base of any filename we create, regardless of extension, or CreateFile
 * will fail with bizarre errors. The set is strict on Windows and advisory
 * on other platforms.
 *
 * @see https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */
const WINDOWS_RESERVED = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
])

/**
 * Name of the content subfolder inside a resource folder. User entries
 * live under `resources/<id>/data/`; metadata dotfiles (`.cover.*`,
 * `.deleted`, `.order`) stay at the resource root. Content and metadata
 * are replaced/kept independently: commits swap the whole `data/`
 * subtree, while root dotfiles survive re-uploads.
 */
export const RESOURCE_DATA_DIR_NAME = "data"

const FORBIDDEN_VISIBLE_CHARS = '<>:"|?*'

function hasControlChar(segment: string): boolean {
	for (let i = 0; i < segment.length; i++) {
		if (segment.charCodeAt(i) < 32) return true
	}
	return false
}

function hasForbiddenVisibleChar(segment: string): boolean {
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i]
		if (ch !== undefined && FORBIDDEN_VISIBLE_CHARS.includes(ch)) return true
	}
	return false
}

/**
 * Root-level subdirectory semantics:
 * - `versions/<version>/` is the user's manual-sync scope, partitioned by
 *   archive version. Each version folder holds: `app.sqlite` (the
 *   per-version database snapshot), `db-backups/` (manual backups,
 *   only kept for the current version), `snapshots/` (automatic daily
 *   snapshots, only kept for the current version), `resources/<id>/`,
 *   `characters/<id>/`, `plugins/<id>/` (installed content plugins
 *   frozen with that version; the builtin `file` plugin is not stored
 *   here). Old versions are FROZEN: no writes ever land in
 *   `versions/<v>` once a `versions/<v+1>` exists.
 * - `local`  holds host-only state. Derived caches (thumbs, previews,
 *   extraction caches, tmp, read-only DB clones for past-version
 *   viewing) live under `local/cache/` and are wiped wholesale by
 *   clear cache; the rest (`logs`, `trash`, session key, upload
 *   staging) is persistent. It never leaves the host.
 *
 * `paths.active` resolves to the **active** version (which may be the
 * latest version, or a past version when the user is viewing
 * read-only). `paths.latest` always points at the latest version --
 * the only version writers may target. `paths.atVersion(v)` exposes
 * arbitrary cross-version reads (used for character avatar/fullbody
 * fallback once `avatarVersion` / `fullbodyVersion` columns point at a
 * historical archive).
 *
 * Every resolved path MUST come out of this module so the frozen-version
 * boundary stays enforceable.
 */
export type StoragePaths = {
	readonly root: string
	readonly activeVersion: number
	readonly latestVersion: number
	readonly active: VersionPaths
	readonly latest: VersionPaths
	readonly local: LocalPaths
	/** Per-version archive paths. Use for cross-version fallback reads. */
	atVersion(v: number): VersionPaths
	/**
	 * Path to the live runtime SQLite DB: `<root>/app.sqlite`.
	 * This file is the only writable database during normal operation.
	 * It lives outside `versions/` so that syncing `versions/` to other
	 * devices cannot corrupt the in-use database. Only archived snapshots
	 * (written by {@link createNextVersion}) and backup files belong in
	 * `versions/`.
	 */
	runtimeDb(): string
}

export type VersionPaths = {
	readonly root: string
	readonly version: number
	/** Path to the per-version SQLite DB: `<root>/versions/<v>/app.sqlite`. */
	versionSnapshotDb(): string
	/** Root folder of a resource: `<root>/versions/<v>/resources/<id>`. */
	resource(id: string): string
	/**
	 * Content root of a resource — where user entries live:
	 * `<root>/versions/<v>/resources/<id>/data`. The container reads
	 * entries from here; the resource root only holds metadata dotfiles.
	 */
	resourceData(id: string): string
	/** Root folder of all resources in this version: `<root>/versions/<v>/resources`. */
	resources(): string
	/** Root folder of all characters in this version: `<root>/versions/<v>/characters`. */
	characters(): string
	/** Root folder of all documents in this version: `<root>/versions/<v>/documents`. */
	documents(): string
	/** Root folder of a character: `<root>/versions/<v>/characters/<id>`. */
	character(id: string): string
	/** Root of manual backups: `<root>/versions/<v>/db-backups`. */
	dbBackups(): string
	/** Path to one manual backup: `<root>/versions/<v>/db-backups/<name>`. */
	dbBackup(name: string): string
	/** Root of automatic snapshots: `<root>/versions/<v>/snapshots`. */
	snapshots(): string
	/** Path to one automatic snapshot: `<root>/versions/<v>/snapshots/<name>`. */
	snapshot(name: string): string
	/**
	 * Path to a deleted-entity placeholder
	 * (`<root>/versions/<v>/<kind>/<id>/.deleted`) written when hard
	 * delete cannot remove a folder whose files live under frozen past
	 * archives.
	 */
	deletedMarker(kind: "resources" | "characters", id: string): string
	/** Root folder of a document: `<root>/versions/<v>/documents/<id>`. */
	document(id: string): string
	/**
	 * Installed content plugins for this version:
	 * `<root>/versions/<v>/plugins`. Each subdirectory is named by
	 * `manifest.id`. The builtin `file` plugin is not stored here.
	 */
	plugins(): string
}

export type LocalPaths = {
	/** The local (non-synced) root: `<root>/local`. */
	readonly root: string
	/** Derived cache root: `<localRoot>/cache`. */
	cache(): string
	/** Server logs: `<localRoot>/logs`. */
	logs(): string
	/**
	 * Path to a local derived cover/thumb variant:
	 * `<localRoot>/cache/<resources|characters>/<id>/<variant>.<format>`.
	 * Holds synthesized covers (resource covers, character avatars and
	 * fullbody images); re-rendered when cleared.
	 */
	localCover(
		subjectKind: "resource" | "character",
		id: string,
		variant: string,
		format?: string,
	): string
	/**
	 * Per-file derived image variant:
	 * `<localRoot>/cache/resources/<id>/file-preview/<sourceCacheId>__<variantKey>.<format>`.
	 * The source identity (see {@link sourceCacheId}) is collision-free
	 * across nested paths; the variant key (see {@link imageVariantKey})
	 * encodes the render spec, so distinct specs never collide on one
	 * cache file.
	 */
	resFileVariant(
		id: string,
		filename: string,
		variantKey: string,
		format?: string,
	): string
	/** Directory holding a resource's per-file variants. */
	resFilePreviewDir(id: string): string
	/** Resource file-list sidecar: `<localRoot>/cache/resources/<id>/files-cache.json`. */
	resFilesCache(id: string): string
	/**
	 * Root of the local per-resource directory:
	 * `<localRoot>/cache/resources/<id>`.
	 */
	resource(id: string): string
	/**
	 * Root of the local per-character directory:
	 * `<localRoot>/cache/characters/<id>`.
	 * Holds (a) versioned copies of replaced avatar / fullbody images and
	 * (b) thumbnail variants (`avatar.webp`, `fullbody.webp`).
	 */
	character(id: string): string
	/** Root of the trash: `<localRoot>/trash`. */
	trash(): string
	/** Path to a single trashed item: `<localRoot>/trash/<id>`. */
	trashItem(id: string): string
	/**
	 * Root of the local temp directory: `<localRoot>/cache/tmp`. Holds
	 * short-lived working files (upload buffers, backup markers, read-only
	 * `view-<v>.sqlite` clones). Lives under the cache root so clear cache
	 * wipes it together with the other derived data; it is also cleaned on
	 * server startup.
	 */
	tmp(): string
	/** Path to a single temp file: `<localRoot>/cache/tmp/<name>`. */
	tmpFile(name: string): string
	/**
	 * Path to the iron-session seal key file: `<root>/local/.session-key`.
	 * 32-byte base64-encoded secret, auto-generated on first boot. Lives in
	 * `local/` (never synced) so each host has its own seal key.
	 */
	sessionKey(): string
	/**
	 * Root of the host-only temporary directory tree:
	 * `<localRoot>/.tmp`. Holds the global staging pool
	 * ({@link stagingPoolRoot}) plus short-lived extraction directories
	 * (`extract-*`). The leading dot keeps host-only state out of any
	 * user-facing listing. Cleared on server startup together with
	 * {@link LocalPaths.tmp}.
	 */
	uploadStagingRoot(): string
	/**
	 * Root of the global staging pool: `<localRoot>/.tmp/staging`.
	 * Every file uploaded through the per-file upload endpoint lands
	 * here as `<fileId><ext>` and is addressed by its `fileId` alone —
	 * there is no per-batch grouping. Files are removed individually
	 * on client delete or consumed (and deleted) by commit at resource
	 * creation. Cleared on startup together with
	 * {@link LocalPaths.uploadStagingRoot}.
	 */
	stagingPoolRoot(): string
	/**
	 * Path of a single staged file in the global pool:
	 * `<stagingPoolRoot>/<fileId><ext>`. `ext` is the lower-cased
	 * extension of the original filename (empty for extensionless
	 * uploads).
	 */
	stagingPoolFile(fileId: string, ext: string): string
	/**
	 * Per-video-frame thumbnail cache:
	 * `<localRoot>/cache/resources/<id>/frames/<sourceCacheId>/<timeMs>.avif`.
	 * Synthesised on-demand by the video hover preview endpoint.
	 */
	resVideoFrame(id: string, filename: string, timeMs: number): string
	/**
	 * Root of persisted zip-entry extractions for a resource version:
	 * `<localRoot>/cache/resources/<id>/extracted/v<fileVersion>/`.
	 */
	resExtractedDir(id: string, fileVersion: number): string
	/**
	 * On-disk path for a materialized zip entry used by probe/ffmpeg
	 * paths: `<localRoot>/cache/resources/<id>/extracted/v<v>/<sourceCacheId>`.
	 */
	resExtractedEntry(id: string, fileVersion: number, entryName: string): string
	/**
	 * Plugin container extraction root for a resource version:
	 * `<localRoot>/cache/resources/<id>/extracted/v<fileVersion>/archives`.
	 * `extractArchive` materializes each archive into its own
	 * subdirectory here (`archives/<archiveName>/<innerPath>`), served to
	 * the browser via the `/extracted/` route.
	 */
	resExtractedArchivesDir(id: string, fileVersion: number): string
}

export type CreateStoragePathsOptions = {
	readonly root: string
	/**
	 * Active (viewing) version. When omitted together with latestVersion,
	 * resolves from `local/version-state.json` and the version dirs under
	 * `versions/`. When only latestVersion is pinned explicitly, defaults to
	 * that same value (call sites that override max version only).
	 */
	readonly activeVersion?: number
	/**
	 * Latest (current, writable) version. When omitted, the maximum
	 * version directory under `versions/` is used, or `1` when none exist.
	 */
	readonly latestVersion?: number
}

/**
 * Build a {@link StoragePaths} rooted at `opts.root`. The root must be an
 * absolute path (the sync boundary would not be well-defined otherwise).
 *
 * @throws `Error` when `root` is not absolute.
 */
export function createStoragePaths(
	opts: CreateStoragePathsOptions,
): StoragePaths {
	if (!isAbsolute(opts.root)) {
		throw new Error(`storage root must be an absolute path: ${opts.root}`)
	}
	const root = resolve(opts.root)
	const versionsRootPath = resolve(root, "versions")
	const localRoot = resolve(root, "local")

	const diskMax = diskCurrentVersion(root)
	let latestVersion: number
	if (opts.latestVersion !== undefined) {
		latestVersion = opts.latestVersion
	} else {
		latestVersion = diskMax > 0 ? diskMax : 1
	}

	let activeVersion: number
	if (opts.activeVersion !== undefined) {
		activeVersion = opts.activeVersion
	} else if (opts.latestVersion !== undefined) {
		activeVersion = latestVersion
	} else {
		activeVersion = diskMax > 0 ? readActiveVersion(root) : latestVersion
	}

	function versionAt(version: number): VersionPaths {
		const vSeg = assertSafeSegment(String(version))
		const vRoot = join(versionsRootPath, vSeg)
		return {
			root: vRoot,
			version,
			versionSnapshotDb: () => join(vRoot, "app.sqlite"),
			resource: (id) => join(vRoot, "resources", assertSafeSegment(id)),
			resourceData: (id) =>
				join(vRoot, "resources", assertSafeSegment(id), RESOURCE_DATA_DIR_NAME),
			resources: () => join(vRoot, "resources"),
			characters: () => join(vRoot, "characters"),
			documents: () => join(vRoot, "documents"),
			character: (id) => join(vRoot, "characters", assertSafeSegment(id)),
			dbBackups: () => join(vRoot, "db-backups"),
			dbBackup: (name) => join(vRoot, "db-backups", assertSafeSegment(name)),
			snapshots: () => join(vRoot, "snapshots"),
			snapshot: (name) => join(vRoot, "snapshots", assertSafeSegment(name)),
			deletedMarker: (kind, id) =>
				join(vRoot, kind, assertSafeSegment(id), ".deleted"),
			document: (id) => join(vRoot, "documents", assertSafeSegment(id)),
			plugins: () => join(vRoot, "plugins"),
		}
	}

	const active = versionAt(activeVersion)
	const latest = versionAt(latestVersion)
	const uploadStagingRootPath = join(localRoot, ".tmp")
	const cacheRoot = join(localRoot, "cache")

	const local: LocalPaths = {
		root: localRoot,
		cache: () => cacheRoot,
		logs: () => join(localRoot, "logs"),
		localCover: (subjectKind, id, variant, format) =>
			join(
				cacheRoot,
				localCoverSubjectDir(subjectKind),
				assertSafeSegment(id),
				`${assertSafeSegment(variant)}.${format ?? "avif"}`,
			),
		resFileVariant: (id, filename, variantKey, format) =>
			join(
				cacheRoot,
				"resources",
				assertSafeSegment(id),
				"file-preview",
				`${assertSafeSegment(sourceCacheId(filename))}__${assertSafeSegment(variantKey)}.${format ?? "avif"}`,
			),
		resFilePreviewDir: (id) =>
			join(cacheRoot, "resources", assertSafeSegment(id), "file-preview"),
		resFilesCache: (id) =>
			join(cacheRoot, "resources", assertSafeSegment(id), "files-cache.json"),
		resource: (id) => join(cacheRoot, "resources", assertSafeSegment(id)),
		character: (id) => join(cacheRoot, "characters", assertSafeSegment(id)),
		trash: () => join(localRoot, "trash"),
		trashItem: (id) => join(localRoot, "trash", assertSafeSegment(id)),
		tmp: () => join(cacheRoot, "tmp"),
		tmpFile: (name) => join(cacheRoot, "tmp", assertSafeSegment(name)),
		sessionKey: () => join(localRoot, ".session-key"),
		uploadStagingRoot: () => uploadStagingRootPath,
		stagingPoolRoot: () => join(uploadStagingRootPath, "staging"),
		stagingPoolFile: (fileId, ext) =>
			join(
				uploadStagingRootPath,
				"staging",
				`${assertSafeSegment(fileId)}${ext}`,
			),
		resVideoFrame: (id, filename, timeMs) =>
			join(
				cacheRoot,
				"resources",
				assertSafeSegment(id),
				"frames",
				assertSafeSegment(sourceCacheId(filename)),
				`${timeMs}.avif`,
			),
		resExtractedDir: (id, fileVersion) =>
			join(
				cacheRoot,
				"resources",
				assertSafeSegment(id),
				"extracted",
				`v${fileVersion}`,
			),
		resExtractedEntry: (id, fileVersion, entryName) =>
			join(
				cacheRoot,
				"resources",
				assertSafeSegment(id),
				"extracted",
				`v${fileVersion}`,
				assertSafeSegment(sourceCacheId(entryName)),
			),
		resExtractedArchivesDir: (id, fileVersion) =>
			join(
				cacheRoot,
				"resources",
				assertSafeSegment(id),
				"extracted",
				`v${fileVersion}`,
				"archives",
			),
	}

	return {
		root,
		activeVersion,
		latestVersion,
		active,
		latest,
		local,
		atVersion: (v) => versionAt(v),
		runtimeDb: () => join(root, "app.sqlite"),
	}
}

/**
 * Map a {@link LocalPaths.thumb} subjectKind onto its on-disk subdirectory.
 * Variants now live flat inside the per-id local directory (no enclosing
 * `thumbs/` parent), so `resource` -> `resources` and `character` ->
 * `characters` (both plural to match the storage layout convention).
 */
function localCoverSubjectDir(subjectKind: "resource" | "character"): string {
	return subjectKind === "resource" ? "resources" : "characters"
}

/**
 * Map a source filename to the readable prefix of its derived-cache
 * identity (see {@link sourceCacheId}). Strips the source extension
 * before {@link LocalPaths.thumb} appends `.webp`, so `1.jpeg` becomes
 * `1__jpeg` (not `1.jpeg.webp`). The source extension is folded into
 * the basename so two sources sharing a stem (e.g. `01.png` /
 * `01.jpg`) cannot collide on the same cache file. Separators are
 * flattened so subdirectory entry names never trip the single-segment
 * path authority check.
 *
 * The encoding (`__<ext>`) avoids any character that
 * {@link assertSafeSegment} rejects (no dot, no separator, no control
 * char) so the result passes the boundary check unchanged.
 */
function toCacheBasename(filename: string): string {
	const dot = filename.lastIndexOf(".")
	if (dot <= 0) return filename.replace(/[/\\]/g, "__")
	const stem = filename.slice(0, dot).replace(/[/\\]/g, "__")
	const ext = filename.slice(dot + 1)
	return `${stem}__${ext}`
}

/**
 * Stable, collision-free cache identity for one source file:
 * the flattened basename (human-readable) plus a short hash of the
 * full relative path. The hash disambiguates flattening ambiguities —
 * `a__b/c.png` and `a/b__c.png` both flatten to `a__b__c__png`, but
 * their paths hash differently, so distinct files never share a cache
 * entry. Pure hex suffix, so the result passes
 * {@link assertSafeSegment} unchanged.
 */
function sourceCacheId(filename: string): string {
	return `${toCacheBasename(filename)}__${shortHash(filename)}`
}

/**
 * Short, stable hash fragment: the first 8 hex chars of the sha256 of
 * `input`. Pure hex, so the result passes {@link assertSafeSegment}
 * unchanged.
 */
function shortHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 8)
}

/**
 * Short, stable cache identity for one derived image variant: the
 * sha256 of the spec's canonical string (see
 * `imageVariantCanonical` in `@hoardodile/sdk-types/image-variant`),
 * truncated to 8 hex chars.
 */
export function imageVariantKey(canonical: string): string {
	return shortHash(canonical)
}

/**
 * Validate a single path segment. We reject anything that embeds a path
 * separator, a drive letter, a NUL or other control code, a Windows
 * reserved basename, or a trailing dot/space (Windows normalises those away
 * and you get the wrong file).
 *
 * @throws `Error` when `segment` is empty or rejected by any of the rules.
 */
export function assertSafeSegment(segment: string): string {
	if (segment.length === 0) throw new Error("path segment must not be empty")
	if (segment === "." || segment === "..") {
		throw new Error(`path segment must not be '${segment}'`)
	}
	if (segment.includes("/") || segment.includes("\\")) {
		throw new Error(`path segment must not contain separators: ${segment}`)
	}
	if (hasForbiddenVisibleChar(segment) || hasControlChar(segment)) {
		throw new Error(`path segment contains disallowed characters: ${segment}`)
	}
	if (segment.endsWith(".") || segment.endsWith(" ")) {
		throw new Error(
			`path segment must not end with dot or space: ${JSON.stringify(segment)}`,
		)
	}
	const base = segment.split(".")[0]?.toUpperCase()
	if (base !== undefined && WINDOWS_RESERVED.has(base)) {
		throw new Error(`path segment is a reserved name: ${segment}`)
	}
	return segment
}

function join(...segments: readonly string[]): string {
	return resolve(...segments)
}

/**
 * Ensure `candidate` is contained within `ancestor` (after `resolve`). Used
 * as a belt-and-braces check before any disk operation that mixes user
 * input with a base directory.
 */
export function assertInside(ancestor: string, candidate: string): string {
	const resolved = resolve(candidate)
	const base = resolve(ancestor)
	if (resolved !== base && !resolved.startsWith(base + sep)) {
		throw new Error(`path ${resolved} escapes ${base}`)
	}
	return resolved
}
