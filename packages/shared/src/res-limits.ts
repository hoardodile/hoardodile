/**
 * Resource image-area caps and pipeline concurrency bounds used by the
 * server's thumbnail/cover pipeline. App-internal — plugin-facing caps
 * (including the resource cover cap, shared with the CLI's workbench
 * renders) live in `@hoardodile/sdk-types/resource` instead.
 */

/** Max pixel area for character avatar crops. */
export const CHARACTER_AVATAR_MAX_AREA = 100_000
/** Max pixel area for character full-body renders. */
export const CHARACTER_FULLBODY_MAX_AREA = 500_000

/**
 * Upper bound on meta rebuilds running at once across all resources.
 * Each rebuild fans out RPC + host probes on a single per-plugin
 * worker, so bursts are queued rather than parallel.
 */
export const RESOURCE_META_REBUILD_CONCURRENCY = 4
