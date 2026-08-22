import type { Codec } from "@hoardodile/sdk-web"
import type { PinnedSectionItem } from "./types"

/**
 * Codec for the ordered list of pinned overview sections.
 *
 * Single-object values from older versions are treated as invalid and fall
 * back to an empty array (no migration).
 */
export const pinnedSectionListCodec: Codec<readonly PinnedSectionItem[]> = {
	encode(value) {
		return JSON.stringify(value)
	},
	decode(raw) {
		if (raw === undefined || raw === "") return undefined
		try {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				return parsed as PinnedSectionItem[]
			}
		} catch {
			// ignore parse errors
		}
		return undefined
	},
} as const
