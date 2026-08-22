/**
 * Plugin-facing resource caps. The preview policy (`exceedsPreviewThresholds`,
 * which consumes the two caps below) lives with its caller in
 * `@hoardodile/sdk-server/helpers`; the cover cap below is consumed by
 * the app's thumb pipeline, the CLI's workbench renders and the media
 * helpers in `@hoardodile/host`. Character image-area caps stay
 * app-internal in `@hoardodile/shared`.
 */

/**
 * Schema version stamped onto every `SearchMeta` payload. Plugins
 * that build search-meta MUST emit this exact value so the host can
 * detect format drift across plugin upgrades.
 */
export const SEARCH_META_VERSION = 1

/** Max pixel area for resource covers; larger images are scaled down. */
export const RESOURCE_COVER_MAX_AREA = 300_000

/** Max pixel area for preview variants served to resource previews. */
export const RESOURCE_PREVIEW_MAX_AREA = 4_000_000

/**
 * Byte-size threshold for preview eligibility. An image whose
 * area is at or below the cap may still qualify for preview when
 * its byte size exceeds this value.
 */
export const RESOURCE_PREVIEW_SIZE_THRESHOLD = 1_000_000
