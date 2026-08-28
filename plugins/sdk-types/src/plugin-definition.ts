/**
 * The plugin definition contract — the single source of truth shared by
 * the authoring SDK (`@hoardodile/sdk-server`), the runtime host
 * (`@hoardodile/host`) and the worker sandbox. Everything here is pure
 * TypeScript with no node or DOM dependencies, so the same contract
 * serves browser-facing packages and node runtimes alike.
 */
import type { MediaKind } from "./media-exts.ts"
import { extToMime, mimeToKind } from "./media-exts.ts"
import type {
	PluginAssetDeleteResult,
	PluginDownloadRequest,
	PluginDownloadResult,
} from "./plugin-asset.ts"
import { pluginAssetError } from "./plugin-asset.ts"
import type { ReadFileRange } from "./read-range.ts"
import type { Result } from "./result.ts"

export type { MediaKind }

/**
 * Schema contract shared between server and web plugin APIs.
 * Declared once per plugin and used to type both `definePlugin` and
 * `WebPluginAPI`.
 */
export interface PluginSchema {
	readonly file?: unknown
	readonly sourceMeta?: unknown
	readonly searchMeta?: unknown
	/**
	 * Plugin-defined payload the `detect` hook may carry on a
	 * successful match. The host keeps the last payload and exposes it
	 * to the plugin's other hooks as `api.context.detect` — classify
	 * once in `detect` instead of rescanning in every hook. Declaring
	 * this slot types the context; hooks must still handle the absent
	 * case (`undefined`: fresh worker, or detect never matched).
	 */
	readonly detect?: unknown
	/**
	 * Plugin-defined anchor location data: the payload carried inside the
	 * wire {@link AnchorData} envelope (see {@link anchorData}). Outgoing
	 * anchors are typed by this slot and passed raw (e.g.
	 * `createMessage({ anchor: { page } })`); incoming anchor data is
	 * validated by the plugin's `decodeAnchor` (see `definePluginAPI` in
	 * `@hoardodile/sdk-react`).
	 */
	readonly anchor?: unknown
}

/**
 * Server plugin detection result: the shared result vocabulary, where a
 * match carries the schema's `detect` payload (when one is declared)
 * and a miss carries its reasons. Plugins may return the literal
 * `{ ok: true } as const` / `{ ok: false, reasons }` shapes directly,
 * or use `ok()`/`err({ reasons })` from the result module.
 *
 * `TPayload` is the plugin's declared `detect` slot — the payload
 * spread onto a match is checked against it at compile time, so a
 * classification that drifts from the schema fails to build.
 */
export type Detection<TPayload extends object = object> = Result<
	TPayload,
	{ readonly reasons: readonly string[] }
>

/** Structured logger scoped to a single plugin. */
export type Logger = {
	info(message: string, data?: Record<string, unknown>): void
	warn(message: string, data?: Record<string, unknown>): void
	error(message: string, data?: Record<string, unknown>): void
}

/** Image probe payload. */
export type ImageInfo = {
	readonly width?: number
	readonly height?: number
}

/** Video probe payload. */
export type VideoInfo = {
	readonly width?: number
	readonly height?: number
	readonly durationMs?: number
}

/**
 * Embedded container tags carried by an audio file (ID3, Vorbis
 * comments, MP4 metadata atoms). Every field is optional — untagged
 * files are normal.
 */
export type AudioTags = {
	readonly title?: string
	readonly artist?: string
	readonly album?: string
}

/**
 * Embedded artwork carried by an audio file (ID3 APIC, FLAC PICTURE,
 * MP4 `covr`). Its presence is the signal that the host can extract a
 * real cover; the dimensions come from the same probe, so callers can
 * pre-size the cover slot without decoding the picture.
 */
export type AudioCoverArt = {
	readonly width?: number
	readonly height?: number
}

/**
 * Audio probe payload. Any field can be absent when the container does
 * not report it.
 */
export type AudioInfo = {
	readonly durationMs?: number
	/** Codec name of the first audio stream, e.g. `"mp3"`, `"flac"`. */
	readonly codec?: string
	/** Container bit rate in bits per second. */
	readonly bitRate?: number
	/** Sample rate of the first audio stream, in Hz. */
	readonly sampleRate?: number
	/** Channel count of the first audio stream. */
	readonly channels?: number
	/** Present only when the file embeds artwork. */
	readonly coverArt?: AudioCoverArt
	readonly tags?: AudioTags
}

/**
 * What a file's bytes say it is. Produced by {@link ResourceAPI.sniff}.
 *
 * `source` records who answered: `"magic"` means the file's own
 * signature was recognized (authoritative), `"extension"` means the
 * content carried no signature and the filename was used instead — the
 * normal outcome for text-based formats, which have no magic bytes.
 *
 * `kind` is provisional for container formats that can hold either
 * audio or video (Ogg, Matroska, ISO-BMFF); {@link ResourceAPI.probe}
 * overrides it with the stream layout actually found in the file.
 */
export type FileType = {
	/** Canonical MIME type, e.g. `"image/jpeg"`. */
	readonly mime: string
	/** Canonical extension for {@link mime}, with leading dot. */
	readonly ext: string
	readonly kind: MediaKind
	readonly source: "magic" | "extension"
}

/**
 * Everything one media probe pass can say about a file, discriminated
 * by the family the content really belongs to — the shape every
 * mainstream prober uses (ffprobe's `format` + `streams`, sharp's
 * `metadata()`, Tika's `MediaType`).
 *
 * `other` is a successful answer: the file was identified and is not
 * decodable media (text, documents, archives). `unknown` is the failure
 * branch and always carries a reason, so "this host has no probe
 * backend" is never confused with "this file is not an image":
 *
 * - `unsupported` — identified, but no backend decodes this format
 * - `unavailable` — the host wired no probe implementation (raw
 *   directory APIs and test fixtures)
 * - `failed` — a backend ran and could not decode the bytes
 */
export type ProbeResult =
	| ({
			readonly kind: "image"
			readonly mime: string
			/** Multi-frame source: animated GIF / WebP / APNG / AVIF. */
			readonly animated: boolean
	  } & ImageInfo)
	| ({ readonly kind: "video"; readonly mime: string } & VideoInfo)
	| ({ readonly kind: "audio"; readonly mime: string } & AudioInfo)
	| { readonly kind: "other"; readonly mime: string }
	| {
			readonly kind: "unknown"
			readonly reason: "unsupported" | "unavailable" | "failed"
	  }

/**
 * Perceptual hash kinds the host can compute for an image file.
 * `dhash` (difference hash) and `phash` (DCT-based perceptual hash)
 * are 64-bit similarity hashes compared by Hamming distance;
 * `sha256` is an exact byte hash. Animated images hash their first
 * frame. Plugins decide which kinds to request and which files to
 * hash — the host only provides the computation.
 */
export const IMAGE_HASH_KINDS = ["sha256", "dhash", "phash"] as const
export type ImageHashKind = (typeof IMAGE_HASH_KINDS)[number]

/**
 * One content hash of a resource file, produced by the plugin's
 * `imageHashes` hook. `scope` is the archive-relative file path,
 * `type` the hash kind (`sha256`/`dhash`/`phash` or a plugin-defined
 * extension), `value` the lowercase hex digest. A resource may expose
 * several hashes (per file × per kind) or none.
 */
export type ImageHash = {
	readonly scope: string
	readonly type: string
	readonly value: string
	/** Bit length of the hash; required for perceptual kinds. */
	readonly bits?: number
}

/** Result of the `imageHashes` hook: hashes per file, possibly empty. */
export type ImageHashesResult = {
	readonly hashes: readonly ImageHash[]
}

/**
 * One file inside a container entry (zip/tar) as listed (or extracted)
 * by the plugin API. `path` is the entry's path inside the archive;
 * dimensions are present when the host probed the entry (image
 * backends) — a listing-only result carries no dimensions.
 */
export type ArchiveExtractionEntry = {
	readonly path: string
	readonly sizeBytes: number
	readonly kind: MediaKind
	readonly width?: number
	readonly height?: number
	readonly animated?: boolean
}

/**
 * A container listing without materialization — the cheap counterpart of
 * {@link ResourceAPI.extractArchive}. Carries entry names, sizes and
 * kinds only; no dimensions (probing those requires the bytes).
 */
export type ContainerListing = {
	readonly entries: readonly ArchiveExtractionEntry[]
}

/**
 * Result of {@link ResourceAPI.extractArchive}: the materialized
 * entries of a container entry. A completed extraction is marked by the
 * host's `index.json` manifest; extraction always writes the cache (the
 * host's `local/cache` is derived data, writable in every view mode).
 */
export type ArchiveExtraction = {
	readonly entries: readonly ArchiveExtractionEntry[]
}

/**
 * Resource-scoped API available to every plugin hook. All paths are
 * relative to the resource's source directory; the host resolves
 * absolute paths transparently.
 *
 * `TSchema` types the injected session context (`context.detect`); the
 * default keeps the API compatible with code that never reads it.
 */
export type ResourceAPI<TSchema extends PluginSchema = PluginSchema> = {
	/** Write an informational log entry. */
	readonly logInfo: (message: string, data?: Record<string, unknown>) => void
	/** Write a warning log entry. */
	readonly logWarn: (message: string, data?: Record<string, unknown>) => void
	/** Write an error log entry. */
	readonly logError: (message: string, data?: Record<string, unknown>) => void
	/**
	 * List all regular-file names (flat list), in canonical display
	 * order: the resource's explicit upload order when one exists (the
	 * host's `.order` manifest), the natural name sort otherwise.
	 * Plugins that need their own ordering should sort explicitly.
	 *
	 * This is the raw name list — the `listFiles` hook of the plugin
	 * definition turns it into typed file entries.
	 */
	readonly listFileNames: () => Promise<readonly string[]>
	/**
	 * Read a regular file relative to the resource root.
	 *
	 * Without `range` the whole file is returned; hosts may reject
	 * oversized full reads — pass a range (or use `readFileChunks` from
	 * `@hoardodile/sdk-server/helpers`) for large files.
	 *
	 * Container addressing: a path of the form `outer!inner` reads the
	 * file *inside* a zip/tar entry (e.g. `manga.cbz!Chapter 1/001.jpg`)
	 * — the host streams the decompressed bytes. When `outer` is not a
	 * container, or the inner entry is absent, the whole path is treated
	 * as a literal filename.
	 */
	readonly readFile: (
		path: string,
		range?: ReadFileRange,
	) => Promise<Uint8Array>
	/**
	 * Return the byte size of `path` without reading the file contents.
	 * Resolves to `undefined` when the file does not exist or the artifact
	 * is not yet committed. Supports container addressing (`outer!inner`).
	 */
	readonly statFile: (
		path: string,
	) => Promise<{ readonly sizeBytes: number } | undefined>
	/**
	 * Batch {@link statFile}: resolves every path in one host round-trip
	 * (positions preserved). Prefer this over a per-file fan-out of
	 * `statFile` when statting a whole archive — one RPC instead of N.
	 */
	readonly statFiles: (
		paths: readonly string[],
	) => Promise<readonly ({ readonly sizeBytes: number } | undefined)[]>
	/**
	 * Identify the file at `path` from its content: magic-byte
	 * detection, falling back to the extension only for formats that
	 * carry no signature (text, subtitles). Resolves to `undefined` when
	 * neither can name the file. Supports container addressing.
	 *
	 * This is the cheap call — it reads a small header window, never
	 * decodes. Use it to route work; use {@link probe} when you need
	 * dimensions, duration or stream details.
	 */
	readonly sniff: (path: string) => Promise<FileType | undefined>
	/**
	 * Decode the media metadata of `path` in one pass, routed by
	 * {@link sniff} rather than by the filename: images resolve through
	 * sharp, audio and video through ffprobe (which also settles
	 * ambiguous containers — an `.ogg` holding only audio streams comes
	 * back as `kind: "audio"`). Supports container addressing.
	 *
	 * Always resolves, never rejects. Non-media files answer
	 * `{ kind: "other" }`; the `unknown` branch carries a `reason` that
	 * distinguishes "no backend wired" (`unavailable`, what raw
	 * directory APIs and fixtures return) from a real decode failure.
	 */
	readonly probe: (path: string) => Promise<ProbeResult>
	/**
	 * Stream-hash the file at `path` (any file kind). Rejects when the
	 * file is missing or the read fails; the host streams the entry so
	 * arbitrarily large files are safe. Supports container addressing.
	 */
	readonly hashBytes: (path: string, algo: "md5" | "sha256") => Promise<string>
	/**
	 * Compute the requested hashes of the image at `path` in one pass:
	 * `sha256` from the raw bytes, `dhash`/`phash` from a decoded
	 * grayscale rendition (animated images use their first frame).
	 * Resolves to `undefined` when the file is not a decodable image;
	 * `kinds` names a subset of {@link IMAGE_HASH_KINDS} and the result
	 * carries exactly those keys. Supports container addressing.
	 */
	readonly computeImageHashes: (
		path: string,
		kinds: readonly ImageHashKind[],
	) => Promise<Readonly<Record<ImageHashKind, string>> | undefined>
	/**
	 * List the file entries of a container entry (zip/tar) without
	 * materializing anything — the cheap call for metadata-only needs
	 * (detect, card counts). Rejects when `filename` is not a supported
	 * container.
	 */
	readonly listContainer: (filename: string) => Promise<ContainerListing>
	/**
	 * Materialize the contents of a container entry (zip/tar) into the
	 * host's extraction cache so the browser can serve the inner files
	 * over plain URLs. `filename` is a literal container entry — the
	 * cache holds one directory per archive with the inner paths
	 * preserved, plus a completion manifest.
	 *
	 * Idempotent: an already-materialized archive re-lists from the
	 * manifest without re-extracting. Rejects when the entry is not a
	 * supported container, exceeds the host's byte/entry budgets, or
	 * when this host wires no extraction cache (test fixtures, raw
	 * directory APIs).
	 */
	readonly extractArchive: (filename: string) => Promise<ArchiveExtraction>
	/**
	 * Ensure remote assets exist in the plugin's own vault — one call with
	 * one request, or one call with an array of requests. When `dest` is
	 * already present the host answers `cached: true` without any dialog
	 * and without touching the network; otherwise the host asks the user
	 * (the web app shows the shared consent dialog with the URLs
	 * verbatim) and downloads on approval.
	 *
	 * An array is ONE consent question for the WHOLE batch (the dialog
	 * lists every item) and is all-or-nothing: any failure discards every
	 * staged file and rejects with the first error, so nothing is
	 * partially committed. Results arrive in request order with `cached`
	 * items keeping their positions. Cap: {@link PLUGIN_ASSET_BATCH_MAX_ITEMS}
	 * items per call. The file always lands inside
	 * `<plugin-dir>/vault/` — `dest` is vault-relative and can never
	 * reach the plugin's bundled files.
	 *
	 * Gated by the manifest `download` permission; rejections carry a
	 * machine-readable {@link PluginAssetErrorName} in `err.name`
	 * (`DENIED` / `UNAVAILABLE` / `POLICY`).
	 */
	readonly download: ((
		request: PluginDownloadRequest,
	) => Promise<PluginDownloadResult>) &
		((
			requests: readonly PluginDownloadRequest[],
		) => Promise<readonly PluginDownloadResult[]>)
	/**
	 * Byte size of a vault file, or `undefined` when absent. The cheap
	 * presence check on top of which `download` resolves cached hits.
	 */
	readonly statAsset: (
		path: string,
	) => Promise<{ readonly sizeBytes: number } | undefined>
	/** Read a vault file's bytes (bounded by the same cap as {@link readFile}). */
	readonly readAsset: (path: string) => Promise<Uint8Array>
	/**
	 * Remove a vault file; idempotent (absent files answer
	 * `{ existed: false }`). The plugin decides the vault's own
	 * lifecycle — e.g. cleaning stale layouts after a plugin update.
	 * No user consent is required: nothing leaves the host. Directories
	 * and paths outside the vault are rejected (`POLICY`).
	 */
	readonly deleteAsset: (path: string) => Promise<PluginAssetDeleteResult>
	/**
	 * Session context injected by the host. `detect` carries the payload
	 * the plugin's `detect` hook returned on its last successful match
	 * (worker-session scope): the one-pass classification every other
	 * hook can build on. `undefined` when detect has not matched in this
	 * session — a fresh worker — so hooks must always handle the absent
	 * case by re-deriving.
	 */
	readonly context: { readonly detect: TSchema["detect"] | undefined }
}

/**
 * Declarative description of a content plugin. Plugins export an instance
 * of this shape as their default export; the host injects the resource
 * API at call time and never invokes a factory function.
 */
export type PluginDefinition<TSchema extends PluginSchema = PluginSchema> = {
	/**
	 * Detect whether this plugin applies to the current resource. A
	 * successful match may carry a payload — `ok({ ...shape })` — which
	 * the host keeps and exposes to the other hooks as
	 * `api.context.detect`. The payload is checked against the schema's
	 * `detect` slot (when one is declared).
	 */
	readonly detect: (
		api: ResourceAPI<TSchema>,
	) => Promise<Detection<TSchema["detect"] & object>>
	/** Optional source metadata builder. */
	readonly sourceMeta?: (
		api: ResourceAPI<TSchema>,
	) => Promise<TSchema["sourceMeta"] | undefined>
	/** Optional search metadata builder. */
	readonly searchMeta?: (
		api: ResourceAPI<TSchema>,
	) => Promise<TSchema["searchMeta"] | undefined>
	/** Optional local cover source resolver. */
	readonly coverLocal?: (
		api: ResourceAPI<TSchema>,
	) => Promise<string | undefined>
	/**
	 * Optional custom file list builder. Results are cached verbatim in a
	 * sidecar. When absent the host falls back to a bare list of source
	 * filenames.
	 */
	readonly listFiles?: (
		api: ResourceAPI<TSchema>,
	) => Promise<readonly TSchema["file"][]>
	/**
	 * Optional content hashes for duplicate detection and image
	 * similarity. The plugin decides the policy — which files to hash
	 * and which kinds — by calling the API's hash primitives; a plugin
	 * facing image-less resources simply omits this hook. Returning
	 * `undefined` (or a hook error) keeps the resource's hash rows empty.
	 */
	readonly imageHashes?: (
		api: ResourceAPI<TSchema>,
	) => Promise<ImageHashesResult | undefined>
	/**
	 * Optional post-install callback, invoked by the host after a
	 * successful install or update commit (marketplace install/update and
	 * zip uploads). Runs with an **install-scoped** API: no resource is
	 * attached — the file surface answers empty and there is no
	 * `context.detect` — while the asset methods still work and stay
	 * gated by the shared consent dialog exactly like the runtime path.
	 * A throwing (or consent-denied) hook never fails the install; the
	 * plugin should treat it as best-effort and re-check at runtime.
	 *
	 * Typical use: fetch pinned runtime files into the plugin vault once,
	 * so the first preview opens without a consent dialog.
	 */
	readonly onInstall?: (api: ResourceAPI<TSchema>) => Promise<void>
}

/** Plugin hook names the host can invoke, in contract order. */
export const HOOK_NAMES = [
	"detect",
	"sourceMeta",
	"searchMeta",
	"coverLocal",
	"listFiles",
	"imageHashes",
	"onInstall",
] as const

export type HookName = (typeof HOOK_NAMES)[number]

function isAsyncFunction(value: unknown): boolean {
	return (
		typeof value === "function" && value.constructor.name === "AsyncFunction"
	)
}

/**
 * Freeze and return a plugin definition. Runs shape validation upfront so
 * a malformed plugin fails at load time with a friendly message instead
 * of misbehaving at hook time.
 */
export function definePlugin<TSchema extends PluginSchema = PluginSchema>(
	definition: PluginDefinition<TSchema>,
): PluginDefinition<TSchema> {
	assertPluginShape(definition)
	return Object.freeze({ ...definition })
}

/**
 * Validate that a value satisfies the structural contract of a
 * {@link PluginDefinition}: only known hooks, all hooks async functions,
 * `detect` required. Does NOT exercise behaviour.
 */
export function assertPluginShape(
	value: unknown,
): asserts value is PluginDefinition {
	if (typeof value !== "object" || value === null) {
		throw new Error("PluginDefinition: expected an object with hook functions")
	}

	const definition = value as Record<string, unknown>

	const knownHooks = new Set<string>(HOOK_NAMES)
	const unknown = Object.keys(definition).filter((key) => !knownHooks.has(key))
	if (unknown.length > 0) {
		throw new Error(
			`PluginDefinition: unknown hook(s) ${unknown.map((k) => `"${k}"`).join(", ")} — expected one of: ${HOOK_NAMES.join(", ")}`,
		)
	}

	for (const hook of HOOK_NAMES) {
		const entry = definition[hook]
		if (entry === undefined) {
			if (hook === "detect") {
				throw new Error("PluginDefinition: missing detect()")
			}
			continue
		}
		if (!isAsyncFunction(entry)) {
			const kind =
				typeof entry === "function" ? "a synchronous function" : typeof entry
			throw new Error(
				`PluginDefinition: "${hook}" must be an async function (got ${kind}) — hooks may do heavy work and the host awaits every hook, so declare it with \`async\`.`,
			)
		}
	}
}

/**
 * Convenience wrapper that builds a failing plugin definition. Used by
 * the host when a plugin directory is missing or its main.js cannot be
 * loaded.
 */
export function createFailingPlugin(
	reasons: readonly string[],
): PluginDefinition {
	return definePlugin({
		detect: async () => ({ ok: false, reasons }),
	})
}

/** Type guard for the success branch of a {@link Detection}. */
export function isDetected(
	detection: Detection,
): detection is { readonly ok: true } {
	return detection.ok
}

/** Type guard for the failure branch of a {@link Detection}. */
export function isMissed(
	detection: Detection,
): detection is { readonly ok: false; readonly reasons: readonly string[] } {
	return !detection.ok
}

/** Declarative configuration for a {@link ResourceAPI} fixture. */
export type ResourceAPIFixtureConfig<
	TSchema extends PluginSchema = PluginSchema,
> = {
	/** File names returned by `listFileNames`. */
	readonly files?: readonly string[]
	/** File contents returned by `readFile`. */
	readonly contents?: Readonly<Record<string, string | Uint8Array>>
	/**
	 * `sniff` results keyed by file path — `{ "a.jpg": … }` matches only
	 * that file, keys starting with a dot match by extension suffix
	 * (`{ ".mp4": … }` applies to every .mp4 file, longest key wins),
	 * and `{ "": … }` matches every path (the usual way to express a
	 * default). Unconfigured paths fall back to the extension table,
	 * exactly like the host's extension branch.
	 */
	readonly types?: Readonly<Record<string, FileType | undefined>>
	/**
	 * `probe` results keyed by file path (same matching rules as
	 * {@link types}). Unconfigured paths mirror the host's routing:
	 * identified non-media answers `{ kind: "other" }`, identified media
	 * answers `{ kind: "unknown", reason: "unavailable" }` — the fixture
	 * decodes nothing, so a hook that needs real dimensions belongs in a
	 * sandbox test instead.
	 */
	readonly probes?: Readonly<Record<string, ProbeResult | undefined>>
	/** Stat results. A plain value is used as the default for all paths. */
	readonly stats?:
		| Readonly<Record<string, { readonly sizeBytes: number } | undefined>>
		| { readonly sizeBytes: number }
		| undefined
	/** `hashBytes` results by path; a plain string is used for all paths. */
	readonly byteHashes?: Readonly<Record<string, string>> | string
	/**
	 * `computeImageHashes` results by path. A plain record is used as the
	 * default for all paths; absent paths resolve to `undefined`.
	 */
	readonly imageHashes?:
		| Readonly<Record<string, ImageHashesResult>>
		| ImageHashesResult
	/**
	 * `listContainer` results keyed by the archive filename. Absent
	 * names reject, mirroring the host's "not a supported archive" error.
	 */
	readonly containerListings?: Readonly<Record<string, ContainerListing>>
	/**
	 * `extractArchive` results keyed by the archive filename. Absent
	 * names reject, mirroring the host's "not a supported archive" error.
	 */
	readonly extractions?: Readonly<Record<string, ArchiveExtraction>>
	/**
	 * Vault file contents keyed by vault-relative path, backing
	 * `statAsset` / `readAsset` / `deleteAsset` in the fixture.
	 */
	readonly assetFiles?: Readonly<Record<string, string | Uint8Array>>
	/**
	 * Handler for `download` (single request or batch of requests, typed
	 * as the union — the fixture returns the matching shape). Absent
	 * means the hosted runtime has no consent channel — `download`
	 * rejects with `UNAVAILABLE`, exactly like the CLI, workbench and
	 * offline mock hosts.
	 */
	readonly downloadHandler?: (
		request: PluginDownloadRequest | readonly PluginDownloadRequest[],
	) => Promise<PluginDownloadResult | readonly PluginDownloadResult[]>
	/**
	 * Container addressing for the fixture: maps a virtual path
	 * (`outer!inner`) to stat/sniff/probe results, so hooks that browse
	 * inside archives can be tested without real archives. Matching rules
	 * mirror {@link types}: exact path keys, dot fragments by suffix,
	 * `{ "": … }` as the default.
	 */
	readonly virtualEntries?: Readonly<Record<string, ArchiveExtractionEntry>>
	/**
	 * Session context handed to hooks as `api.context` — mirrors the
	 * host injecting the payload of a prior successful `detect`. Typed
	 * by the schema generic when one is supplied.
	 */
	readonly context?: { readonly detect?: TSchema["detect"] }
}

function resolveKeyed<T>(
	path: string,
	table: Readonly<Record<string, T | undefined>> | undefined,
): T | undefined {
	if (table === undefined) return undefined
	// Keys match the path exactly, except keys that start with a dot —
	// those are extension fragments matching any path ending with them
	// (`.mp4` applies to every .mp4 file). The longest fragment wins so
	// a shared default is never shadowed; the empty key `""` is the
	// catch-all default. Plain-name keys never match by substring, so
	// `"a.jpg"` cannot hijack `"ba.jpg"`.
	if (Object.hasOwn(table, path)) return table[path]
	let bestKey: string | undefined
	let bestLen = -1
	for (const key of Object.keys(table)) {
		if (key.length > bestLen && key.startsWith(".") && path.endsWith(key)) {
			bestKey = key
			bestLen = key.length
		}
	}
	if (bestKey !== undefined) return table[bestKey]
	return table[""]
}

/** Lower-cased extension from the last dot, or `""` when there is none. */
function lastExt(path: string): string {
	const dot = path.lastIndexOf(".")
	return dot === -1 ? "" : path.slice(dot).toLowerCase()
}

/**
 * Identify a file from its name alone: the extension branch of content
 * sniffing, exposed on its own because it is also the honest answer for
 * formats that carry no signature, and the shape test doubles need when
 * standing in for a real {@link ResourceAPI}.
 */
export function fileTypeFromName(path: string): FileType | undefined {
	const ext = lastExt(path)
	const mime = extToMime(ext)
	if (mime === undefined) return undefined
	return { mime, ext, kind: mimeToKind(mime), source: "extension" }
}

function resolveValue<T>(
	path: string,
	value: Readonly<Record<string, T | undefined>> | T | undefined,
	defaultValue: T | undefined,
): T | undefined {
	if (value === undefined || value === null) return defaultValue
	if (typeof value !== "object" || Array.isArray(value)) return value
	// Matching rules mirror {@link resolveKeyed}: exact keys, dot
	// fragments by suffix (longest wins), empty-key default.
	const table = value as Readonly<Record<string, T | undefined>>
	if (Object.hasOwn(table, path)) return table[path]
	let bestKey: string | undefined
	let bestLen = -1
	for (const key of Object.keys(table)) {
		if (key.length > bestLen && key.startsWith(".") && path.endsWith(key)) {
			bestKey = key
			bestLen = key.length
		}
	}
	if (bestKey !== undefined) return table[bestKey]
	return table[""] ?? defaultValue
}

function virtualStat(
	path: string,
	table:
		| Readonly<Record<string, ArchiveExtractionEntry | undefined>>
		| undefined,
): { readonly sizeBytes: number } | undefined {
	const entry = resolveKeyed(path, table)
	return entry === undefined ? undefined : { sizeBytes: entry.sizeBytes }
}

function virtualType(
	path: string,
	table:
		| Readonly<Record<string, ArchiveExtractionEntry | undefined>>
		| undefined,
): FileType | undefined {
	if (resolveKeyed(path, table) === undefined) return undefined
	return fileTypeFromName(path.slice(path.lastIndexOf("!") + 1))
}

/**
 * Create a mutable {@link ResourceAPI} fixture driven by a declarative
 * config. No filesystem involved — the standard way to unit-test plugin
 * hooks.
 *
 * Pass the plugin's schema as the generic
 * (`createResourceAPIFixture<MySchema>()`) so the returned api carries
 * the typed session context — the same shape schema-typed hooks receive
 * from the host.
 */
export function createResourceAPIFixture<
	TSchema extends PluginSchema = PluginSchema,
>(
	initialConfig: ResourceAPIFixtureConfig<TSchema> = {},
): {
	readonly api: ResourceAPI<TSchema>
	readonly setConfig: (next: ResourceAPIFixtureConfig<TSchema>) => void
} {
	let config: ResourceAPIFixtureConfig<TSchema> = initialConfig

	function setConfig(next: ResourceAPIFixtureConfig<TSchema>): void {
		config = next
	}

	const api: ResourceAPI<TSchema> = {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: config.context?.detect },
		async listFileNames() {
			return config.files ?? []
		},
		async readFile(path, range) {
			const content = config.contents?.[path]
			if (content === undefined) {
				throw new Error(`ResourceAPIFixture: no content for "${path}"`)
			}
			const bytes =
				typeof content === "string"
					? new TextEncoder().encode(content)
					: content
			if (range === undefined) return bytes
			// Mirrors host semantics: the range is clamped to the content size.
			return bytes.slice(range.start ?? 0, range.end)
		},
		async statFile(path) {
			return (
				resolveValue(path, config.stats, undefined) ??
				virtualStat(path, config.virtualEntries)
			)
		},
		async statFiles(paths) {
			return Promise.all(
				paths.map(
					(path) =>
						resolveValue(path, config.stats, undefined) ??
						virtualStat(path, config.virtualEntries),
				),
			)
		},
		async sniff(path) {
			return (
				resolveKeyed(path, config.types) ??
				fileTypeFromName(path) ??
				virtualType(path, config.virtualEntries)
			)
		},
		async probe(path) {
			const configured = resolveKeyed(path, config.probes)
			if (configured !== undefined) return configured
			// Unconfigured paths mirror the host's own routing: a file the
			// fixture cannot identify is unsupported, an identified
			// non-media file answers `other`, and identified media needs a
			// real decode the fixture has no backend for.
			const type =
				resolveKeyed(path, config.types) ??
				fileTypeFromName(path) ??
				virtualType(path, config.virtualEntries)
			if (type === undefined) return { kind: "unknown", reason: "unsupported" }
			if (type.kind === "other") return { kind: "other", mime: type.mime }
			const virtual = resolveKeyed(path, config.virtualEntries)
			if (virtual !== undefined && type.kind === "image") {
				return {
					kind: "image",
					mime: type.mime,
					width: virtual.width,
					height: virtual.height,
					animated: virtual.animated ?? false,
				}
			}
			return { kind: "unknown", reason: "unavailable" }
		},
		async hashBytes(path) {
			const value = resolveValue(path, config.byteHashes, undefined)
			if (value === undefined) {
				throw new Error(`ResourceAPIFixture: no byte hash for "${path}"`)
			}
			return value
		},
		async computeImageHashes(path, kinds) {
			const result = resolveValue(path, config.imageHashes, undefined)
			if (result === undefined) return undefined
			const hashes: Record<string, string> = {}
			for (const entry of result.hashes) {
				if ((kinds as readonly string[]).includes(entry.type)) {
					hashes[entry.type] = entry.value
				}
			}
			return hashes as Record<ImageHashKind, string>
		},
		async extractArchive(filename) {
			const configured = config.extractions?.[filename]
			if (configured === undefined) {
				throw new Error(
					`ResourceAPIFixture: no extraction configured for "${filename}"`,
				)
			}
			return configured
		},
		async listContainer(filename) {
			const configured = config.containerListings?.[filename]
			if (configured === undefined) {
				throw new Error(
					`ResourceAPIFixture: no container listing configured for "${filename}"`,
				)
			}
			return configured
		},
		download: (async (
			request: PluginDownloadRequest | readonly PluginDownloadRequest[],
		) => {
			if (config.downloadHandler === undefined) {
				throw pluginAssetError(
					"UNAVAILABLE",
					"ResourceAPIFixture: no download handler configured",
				)
			}
			const result = await config.downloadHandler(request)
			// Mirror the real host: batch in → batch out, single in →
			// single out.
			if (Array.isArray(request)) {
				return Array.isArray(result) ? result : [result]
			}
			return Array.isArray(result) ? (result[0] ?? result) : result
		}) as ResourceAPI<TSchema>["download"],
		async statAsset(path) {
			const content = resolveValue(path, config.assetFiles, undefined)
			if (content === undefined) return undefined
			return { sizeBytes: fixtureContentBytes(content).byteLength }
		},
		async readAsset(path) {
			const content = resolveValue(path, config.assetFiles, undefined)
			if (content === undefined) {
				throw new Error(`ResourceAPIFixture: no vault file "${path}"`)
			}
			return fixtureContentBytes(content)
		},
		async deleteAsset(path) {
			const table = config.assetFiles
			if (table === undefined || !Object.hasOwn(table, path)) {
				return { existed: false }
			}
			// Fixture config is immutable in spirit — a delete is simulated
			// by copying with the entry removed, so the next call sees it gone.
			const next: Record<string, string | Uint8Array> = {}
			for (const [key, value] of Object.entries(table)) {
				if (key !== path) next[key] = value
			}
			config = { ...config, assetFiles: next }
			return { existed: true }
		},
	}

	return { api, setConfig }
}

/** Convert a fixture content entry (string or bytes) to `Uint8Array`. */
function fixtureContentBytes(content: string | Uint8Array): Uint8Array {
	return typeof content === "string"
		? new TextEncoder().encode(content)
		: content
}

/** Return a minimal {@link Logger} for tests. */
export function stubLogger(overrides?: Partial<Logger>): Logger {
	return {
		info() {},
		warn() {},
		error() {},
		...overrides,
	}
}
