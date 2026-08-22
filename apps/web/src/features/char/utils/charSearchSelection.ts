import type {
	CardSelectionState,
	SearchMultiSelection,
	SearchSelection,
	SearchSingleSelection,
} from "@/lib/searchSelection"
import {
	resolveCardSelection,
	toggleSelectionMembership,
} from "@/lib/searchSelection"

export type CharSearchMultiSelection = SearchMultiSelection
export type CharSearchSingleSelection = SearchSingleSelection
export type CharSearchSelection = SearchSelection
export type { CardSelectionState }

export { resolveCardSelection, toggleSelectionMembership }
