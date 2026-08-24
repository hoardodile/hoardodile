import { pluginManifestId } from "@hoardodile/sdk-types/schema"
import { z } from "zod"
import { resCollectionChip } from "./col.ts"
import { charImageMeta, emptyMeta, isEmptyMeta } from "./image-meta.ts"
import { id, timestamp } from "./primitives.ts"
import { pinnedTag } from "./tag.ts"
import {
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_SOURCE_NAME_LENGTH,
	MAX_URL_LENGTH,
} from "./text-limits.ts"

/**
 * The fixed catalog of cover rendering variants. `coverMeta.kind` picks
 * which variant the web app renders (e.g. `"video"` enables hover-to-play).
 */
export const COVER_KINDS = ["image", "video", "audio"] as const
export type CoverKind = (typeof COVER_KINDS)[number]

/**
 * Populated cover metadata. `coverMeta` as a whole is a union with
 * {@link emptyMeta}: absent/undefined means not computed yet; `{ empty:
 * true }` means computed with no cover file; this object means a cover
 * exists.
 */
export const populatedCoverMeta = z.object({
	/**
	 * Intrinsic pixel dimensions of the cover image. Used by the client
	 * to pre-size the image slot before the image loads, preventing layout
	 * shifts.
	 */
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	/**
	 * Which media variant the web app renders (e.g. "video" enables
	 * hover-to-play). Derived from the owning plugin's `buildLocalCover`
	 * source file, not from a user-uploaded permanent `.cover.*` image.
	 */
	kind: z.enum(COVER_KINDS),
	/**
	 * Filename (relative to resource root) of the source file used as cover
	 * origin. Set from `buildLocalCover` during cover meta build. Present
	 * whenever the plugin resolves a local cover source, including when a
	 * user-uploaded permanent `.cover.*` image overrides the thumbnail.
	 */
	source: z.string().optional(),
})
export type PopulatedCoverMeta = z.infer<typeof populatedCoverMeta>

/**
 * An item of content owned by the user.
 * `coverMeta` absent means the app should derive a cover automatically.
 * `deletedAt` absent means the resource is live.
 */
export const coverMeta = z.union([emptyMeta, populatedCoverMeta])
export type CoverMeta = z.infer<typeof coverMeta>

/** Strip the empty sentinel so callers can read `kind` / dimensions. */
export function populatedCover(
	meta: CoverMeta | undefined,
): PopulatedCoverMeta | undefined {
	if (meta === undefined || isEmptyMeta(meta)) return undefined
	return meta
}

/**
 * Universal file-level facts about the resource's source artifact,
 * independent of any plugin. Available on every resource the moment
 * source files exist.
 *
 * The source lives as bare files in `<resource>/` (archives stay as
 * single files; entry names may nest under subdirectories).
 * `sizeBytes` is the cumulative byte size of all files; `count` is the
 * number of files. Every resource uses this shape, even single-file
 * ones.
 */
export const fileStats = z.object({
	sizeBytes: z.number().int().nonnegative().optional(),
	count: z.number().int().nonnegative().optional(),
})
export type FileStats = z.infer<typeof fileStats>

/**
 * Plugin-specific per-resource metadata. No host-enforced fields;
 * everything is plugin-defined and passes through unchanged.
 */
export const sourceMetaBase = z.object({}).passthrough()
export type SourceMetaBase = z.infer<typeof sourceMetaBase>

/**
 * Read the well-known `kind` field out of a {@link coverMeta} blob.
 * Returns `undefined` when the blob is missing, the field is missing,
 * or the value isn't one of {@link COVER_KINDS}.
 */
export function pickCoverKind(coverMeta: unknown): CoverKind | undefined {
	if (typeof coverMeta !== "object" || coverMeta === null) return undefined
	if (isEmptyMeta(coverMeta)) return undefined
	const candidate = (coverMeta as Record<string, unknown>).kind
	if (typeof candidate !== "string") return undefined
	for (const kind of COVER_KINDS) {
		if (kind === candidate) return kind
	}
	return undefined
}

/**
 * Per-resource search-optimisation metadata. Built eagerly at upload /
 * import time by the owning plugin so search queries never touch the
 * file system.
 *
 * `facets` is a plugin-defined bag of boolean flags (e.g. `image`,
 * `video`, `audio`). The keys are opaque to shared/server/web -- the
 * plugin declares them via `ui.search.kinds` in its manifest so the
 * UI can render filter checkboxes with i18n labels and icons.
 *
 * `v` is bumped whenever the owning plugin changes its build algorithm
 * incompatibly so a one-shot rebuild can identify stale rows.
 */
export const searchMeta = z.object({
	v: z.number().int().positive(),
	facets: z.record(z.string(), z.boolean()).optional(),
})
export type SearchMeta = z.infer<typeof searchMeta>

/**
 * Hash-rebuild state marker carried on the resource meta row. `{"v":1}`
 * once the owning plugin's `imageHashes` hook ran (even when it produced
 * zero hashes); null means no hash rebuild happened yet or the plugin
 * provides none. The actual hashes live in the server-side
 * `resource_hashes` table — this is only the "computed" signal.
 *
 * `pluginVersion` is the owning plugin's manifest version at rebuild
 * time: a version mismatch marks the rows stale (a plugin upgrade may
 * change its hash algorithm), so the next lazy rebuild recomputes them.
 */
export const hashesMeta = z.object({
	v: z.number().int().positive(),
	pluginVersion: z.string().optional(),
})
export type HashesMeta = z.infer<typeof hashesMeta>

/**
 * Generation of the `hashesMeta` payload / perceptual hash algorithm.
 * Bumping this marks every existing `hashesMeta` row stale (see the
 * server's staleness check), forcing a lazy hash rebuild across the
 * library the next time each resource is viewed.
 */
export const HASHES_META_VERSION = 2

/**
 * Window during which a resource dislike can still be cancelled, in
 * milliseconds. Mirrors {@link COMMENT_VOTE_CANCEL_WINDOW_MS}.
 */
export const RESOURCE_DISLIKE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Individual dislike record. `cancellable` is `true` while the row is
 * still inside its 24h window -- the server computes it from `createdAt`
 * so clients do not need to embed clock logic.
 */
export const resourceDislike = z.object({
	id,
	resourceId: id,
	createdAt: timestamp,
	cancellable: z.boolean(),
})

export type ResourceDislike = z.infer<typeof resourceDislike>

/**
 * Outcome of a dislike click. Within the 24h window the server collapses
 * a repeat click into a cancel; outside the window each click creates an
 * independent permanent row that contributes to the count.
 */
export const resourceDislikeAction = z.enum(["added", "cancelled"])

export const resourceDislikeResult = z.object({
	action: resourceDislikeAction,
	dislike: resourceDislike.optional(),
})

export type ResourceDislikeResult = z.infer<typeof resourceDislikeResult>

export const RESOURCE_META_TYPES = [
	"coverMeta",
	"sourceMeta",
	"searchMeta",
	"fileStats",
	"imageHashes",
] as const
export type ResourceMetaType = (typeof RESOURCE_META_TYPES)[number]

/** Partial meta fields carried on SSE `resourceMetaUpdated` events. */
export type ResourceMetaSnapshot = {
	coverMeta?: CoverMeta | null
	sourceMeta?: SourceMetaBase | null
	searchMeta?: SearchMeta | null
	fileStats?: FileStats | null
	hashesMeta?: HashesMeta | null
}

export type ResourceMetaUpdatedEvent = {
	type: "resourceMetaUpdated"
	resourceId: string
	metaTypes: ResourceMetaType[]
	meta?: ResourceMetaSnapshot
}

/**
 * Emitted when the server finishes an in-process storage context reload
 * (backup restore or archive version switch). Clients should invalidate
 * cached query data because the underlying database / active version has
 * changed while the HTTP/SSE connection stayed alive.
 */
export type StorageContextReloadedEvent = {
	type: "storageContextReloaded"
}

/**
 * Emitted when a plugin asks to download into its own asset vault and the
 * host needs the user's consent. The web app shows the shared consent
 * dialog from this event (URL shown verbatim); any connected tab may
 * answer via the `pluginAsset.decide` procedure. `sizeBytes` is present
 * when a cheap HEAD probe succeeded at request time.
 */
export type PluginDownloadRequestedEvent = {
	type: "pluginDownloadRequested"
	ticketId: string
	pluginId: string
	pluginName: string
	url: string
	dest: string
	sizeBytes?: number
	reason?: string
}

/**
 * Emitted when a consent ticket was resolved (decided, timed out, or the
 * broker was disposed). Every tab closes the matching dialog entry —
 * the dialog can appear in several tabs at once, the answer lives in one.
 */
export type PluginDownloadResolvedEvent = {
	type: "pluginDownloadResolved"
	ticketId: string
}

export const resource = z.object({
	id,
	name: z.string().min(1).max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_INTRO_LENGTH).default(""),
	/**
	 * User-set provenance: display name of the origin (a site, platform,
	 * forum, or any other web page). Both source fields are optional;
	 * users are encouraged to set at least one so the origin stays
	 * discoverable.
	 */
	sourceName: z.string().max(MAX_SOURCE_NAME_LENGTH).optional(),
	/**
	 * User-set provenance: external link to the origin page. Length-capped
	 * only (not `z.string().url()`) because pasted addresses often lack a
	 * scheme; the client renders the link and prepends `https://` when the
	 * scheme is missing.
	 */
	sourceUrl: z.string().max(MAX_URL_LENGTH).optional(),
	tagIds: z.array(id).default([]),
	charIds: z.array(id).default([]),
	/** Plugin that owns detection and preview for this resource. Null until first source upload. */
	contentPluginId: pluginManifestId.nullable(),
	/**
	 * Plugin id the server resolved for this resource's read paths at
	 * response time: `contentPluginId` when that plugin is still
	 * registered and enabled, otherwise the builtin fallback plugin id.
	 * Always present on responses from the res service; optional because
	 * the field is additive.
	 */
	previewPluginId: pluginManifestId.optional(),
	/**
	 * Cover metadata (dimensions + kind), or `{ empty: true }` when a
	 * rebuild confirmed there is no cover. Absent when no cover has been
	 * generated yet.
	 */
	coverMeta: coverMeta.optional(),
	/**
	 * Universal file-level facts (size, count). Plugin-agnostic; computed
	 * by the server's source-tree walker. Absent until the first probe runs.
	 */
	fileStats: fileStats.optional(),
	/**
	 * Plugin-owned per-resource JSON produced by the owning plugin's
	 * `buildSourceMeta()`. No host-enforced fields; everything is
	 * plugin-defined and passed through.
	 *
	 * Well-known optional fields the host may read:
	 *  - `previews: readonly string[]` is an opt-in first-paint hint:
	 *    up to 3 media-file relative paths the plugin can render
	 *    synchronously from `ctx.sourceMeta` before its `useResFiles()`
	 *    round-trip resolves. Used by image-only and image/video/audio
	 *    plugins alike. Safe to omit;
	 *    consumers must fall through to `useResFiles()` when absent or
	 *    malformed. Resources are archive-immutable, so these paths
	 *    never need invalidation.
	 *
	 * Absent until built.
	 */
	sourceMeta: sourceMetaBase.optional(),
	/**
	 * Search-optimisation metadata built at upload / import time. Absent
	 * for resources created before the feature shipped or whose source
	 * folder is empty. See {@link searchMeta} for layout.
	 */
	searchMeta: searchMeta.optional(),
	/**
	 * Archive version where this resource's user-uploaded permanent
	 * `.cover.*` file lives. Bumped on every cover write/delete.
	 */
	coverVersion: z.number().int().positive(),
	createdAt: timestamp,
	updatedAt: timestamp,
	deletedAt: timestamp.optional(),
	/**
	 * Present only when the most recent read detected source drift and the
	 * active `contentPluginId` detector rejected the new layout.
	 * `from` carries the previous content type (which the server already
	 * downgraded back to the builtin fallback plugin), `reason` lists the
	 * items so the frontend can prompt the user.
	 */
	degraded: z
		.object({
			from: pluginManifestId,
			reason: z.array(z.string()),
		})
		.optional(),
	/**
	 * Total dislike clicks recorded for this resource. Each click creates
	 * one row; rows are cancellable only within the 24h window
	 * (`RESOURCE_DISLIKE_CANCEL_WINDOW_MS`). Server-computed.
	 */
	dislikeCount: z.number().int().nonnegative(),
	/**
	 * Whether the most recent dislike is still inside its cancellation
	 * window (a repeat click within 24h removes it). Server-computed so
	 * clients do not embed clock logic.
	 */
	dislikedRecently: z.boolean(),
})

export type Resource = z.infer<typeof resource>

/** One file-level match inside a {@link similarImagesResult} entry. */
export const similarFileMatch = z.object({
	/** Archive-relative file path in the matched resource. */
	scope: z.string(),
	/** Bit width of the perceptual hash (e.g. 64 for dhash/phash). */
	bits: z.number().int().positive(),
	/** Hamming distance to the query hash (0 = identical hash). */
	distance: z.number().int().nonnegative(),
})
export type SimilarFileMatch = z.infer<typeof similarFileMatch>

/**
 * Similar-image result entry: another live resource sharing perceptual
 * hashes with the query resource, ranked by best Hamming distance.
 * `files` lists the matched file pairs for context (e.g. a shared title
 * page between chapters shows up as a single-file match).
 */
export const similarImagesEntry = z.object({
	resource: resource,
	files: z.array(similarFileMatch),
})
export type SimilarImagesEntry = z.infer<typeof similarImagesEntry>

export const similarImagesResult = z.array(similarImagesEntry)
export type SimilarImagesResult = z.infer<typeof similarImagesResult>

/**
 * One file in an {@link intraSimilarGroup}: a file of the query resource
 * whose perceptual hash stays within the similarity threshold of at
 * least one other member of the group.
 */
export const intraSimilarFileMatch = z.object({
	/** Archive-relative file path in the query resource. */
	scope: z.string(),
	/** Bit width of the perceptual hash (e.g. 64 for dhash/phash). */
	bits: z.number().int().positive(),
	/** Best Hamming distance to any other member of the group. */
	distance: z.number().int().nonnegative(),
})
export type IntraSimilarFileMatch = z.infer<typeof intraSimilarFileMatch>

/**
 * A group of files inside one resource that are perceptually similar to
 * each other (transitively clustered). Lets a gallery holding many
 * near-identical shots surface them without comparing against other
 * resources.
 */
export const intraSimilarGroup = z.object({
	files: z.array(intraSimilarFileMatch).min(2),
})
export type IntraSimilarGroup = z.infer<typeof intraSimilarGroup>

export const intraSimilarResult = z.array(intraSimilarGroup)
export type IntraSimilarResult = z.infer<typeof intraSimilarResult>

/** One file-level duplicate inside a {@link duplicateImagesResult} entry. */
export const duplicateFileMatch = z.object({
	/** Archive-relative file path in the query resource. */
	scope: z.string(),
	/** Archive-relative file path in the matched resource. */
	otherScope: z.string(),
	/** Hash kind that matched (e.g. `sha256`). */
	type: z.string(),
})
export type DuplicateFileMatch = z.infer<typeof duplicateFileMatch>

/**
 * Duplicate-image result entry: another live resource holding exact
 * byte-identical files (sha256) with the query resource.
 */
export const duplicateImagesEntry = z.object({
	resource: resource,
	files: z.array(duplicateFileMatch),
})
export type DuplicateImagesEntry = z.infer<typeof duplicateImagesEntry>

export const duplicateImagesResult = z.array(duplicateImagesEntry)
export type DuplicateImagesResult = z.infer<typeof duplicateImagesResult>

/**
 * Resource with pre-computed pinned tags and character summaries, returned by
 * the `resource.listCards` procedure. The server resolves both before sending
 * so the client needs no extra queries or local tag resolution.
 *
 * `pinnedTags` - filtered to `tag.pinned OR category.pinned`, sorted by
 *   (category.position, tag.position), color resolved: tag -> category -> "".
 * `characters` - minimal character info needed for avatar thumbnails and links.
 */
export const resCard = resource.extend({
	pinnedTags: z.array(pinnedTag).default([]),
	characters: z
		.array(
			z.object({
				id,
				name: z.string().min(1).max(MAX_NAME_LENGTH),
				updatedAt: timestamp,
				imageMeta: charImageMeta.optional(),
			}),
		)
		.default([]),
	/**
	 * Collections that contain this resource. Embedded so card grids can
	 * render collection chips without an N+1 fetch per card.
	 */
	collections: z.array(resCollectionChip).default([]),
})

export type ResCard = z.infer<typeof resCard>
