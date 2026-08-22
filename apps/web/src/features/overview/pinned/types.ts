import type { TraitFilter } from "@hoardodile/schemas"
import type { PluginManifestId } from "@hoardodile/sdk-types"
import type { SortBy, SortOrder, TagFilterMode } from "@hoardodile/shared"

export const MAX_PINNED_SECTION_ITEMS = 6

/** Default number of cards shown in a pinned section when `size` is unset. */
export const DEFAULT_PINNED_SIZE = 10

/**
 * Overview pinned section snapshot.
 *
 * `pinned: true` distinguishes an explicit pin from no saved config.
 */
export type PinnedFilterConfig = {
	readonly pinned?: boolean
	readonly title?: string
	readonly showWhenEmpty?: boolean
	readonly size?: number
	readonly query?: string
	readonly tagIds?: readonly string[]
	readonly tagMode?: TagFilterMode
	readonly traitFilters?: readonly TraitFilter[]
	readonly searchIntro?: boolean
	readonly relationshipTypeIds?: readonly string[]
	readonly sortBy?: SortBy
	readonly order?: SortOrder
	readonly random?: boolean
	// Resource-only fields; ignored by the character pinned section.
	readonly noCharacters?: boolean
	readonly contentPluginId?: PluginManifestId
	readonly searchMetaFacets?: Record<string, boolean>
}

/** Filter fields only, without section metadata. */
export type PinnedFilters = Omit<
	PinnedFilterConfig,
	"pinned" | "title" | "showWhenEmpty" | "size"
>

/**
 * A single pinned section entry stored in the ordered list.
 *
 * Presence in the list means the section is pinned; `pinned` is not needed.
 */
export type PinnedSectionItem = {
	readonly id: string
	readonly title?: string
	readonly enabled?: boolean
	readonly showWhenEmpty?: boolean
	readonly size?: number
	/**
	 * Auto-refresh interval in seconds (see PINNED_REFRESH_INTERVALS). Only
	 * meaningful for random items; unset means 0 ("always") so legacy data
	 * keeps the live-refresh behavior.
	 */
	readonly refreshSec?: number
} & PinnedFilters
