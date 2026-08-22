/**
 * Plugin-facing text-length limits: the input caps plugins that render
 * composers need. App-side field limits live in
 * `@hoardodile/schemas/text-limits` instead.
 */

/** Danmaku body cap enforced by the host. */
export const MAX_DANMAKU_TEXT_LENGTH = 100

/** Comment/message body cap enforced by the host. */
export const MAX_COMMENT_BODY_LENGTH = 10_000
