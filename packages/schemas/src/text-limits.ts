/**
 * App-side text-length limits shared by the server's validation schemas
 * and the web forms that constrain input. Each constant is the single
 * source of truth for one field; names encode their field
 * ("MAX_DANMAKU_COLOR" is the danmaku color value).
 *
 * Plugin-facing input limits (danmaku body, comment body) live in
 * `@hoardodile/sdk-types/text-limits` — plugins that render composers need
 * them; the rest is app UI/schema concern only.
 */

// Names (entity display names shown in cards, chips, lists)
export const MAX_NAME_LENGTH = 512
export const MAX_TRAIT_NAME_LENGTH = 64

// Intros / descriptions
export const MAX_INTRO_LENGTH = 1000
export const MAX_CHARACTER_INTRO_LENGTH = 1024
export const MAX_SOURCE_NAME_LENGTH = 128

// Short text (colors, labels, codes)
export const MAX_COLOR_LENGTH = 100
export const MAX_DANMAKU_COLOR_LENGTH = 32
export const MAX_RELATIONSHIP_LABEL_LENGTH = 128
export const MAX_RELATIONSHIP_TYPE_NAME_LENGTH = 256

// Long text (comments, prompts, messages)
export const MAX_COMMIT_MESSAGE_LENGTH = 2000

// Document body (plain-text character count, not JSON size)
export const MAX_DOC_CONTENT_TEXT_LENGTH = 1_000_000

// URLs / keys / identifiers
export const MAX_URL_LENGTH = 2000
export const MAX_BACKUP_NAME_LENGTH = 255
export const MAX_VERSION_NAME_LENGTH = 128
export const MAX_HISTORY_NOTE_LENGTH = 512

// Search / pagination
export const MAX_SEARCH_QUERY_LENGTH = 512
export const MAX_DOC_SEARCH_QUERY_LENGTH = 500
export const MAX_DOC_SNIPPET_LENGTH = 300
export const MAX_PAGE_SIZE = 200
/**
 * Cap for id-set filters on list procedures (selections can exceed a page).
 * Ids travel in the POST body (tRPC queries use methodOverride: "POST"), so
 * 9999 uuids ≈ 430 KB stays well under Fastify's default 1 MB bodyLimit and
 * SQLite's 32766 bind-variable limit.
 */
export const MAX_ID_FILTER_SIZE = 9999

// Trait filter
export const MAX_TRAIT_FILTER_VALUE_LENGTH = 256
