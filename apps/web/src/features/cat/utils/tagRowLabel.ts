import type { CatKind } from "@hoardodile/schemas"
import type { TFunction } from "i18next"
import type { TagSiblingGroup } from "@/features/tags/api"
import type { TagWithCounts } from "../panelModel"
import { tagLineLabel } from "./tagLineLabel"

/**
 * The effective counts of a tag row: a sibling-group display tag shows
 * its group's union counts, everything else its own.
 */
export function effectiveTagCounts(
	tag: TagWithCounts,
	group: TagSiblingGroup | undefined,
): TagWithCounts {
	return group !== undefined && group.displayTagId === tag.id
		? { ...tag, resCount: group.resCount, charCount: group.charCount }
		: tag
}

export type TagRowLabel = {
	/** The tag's own name. */
	readonly name: string
	/** Dot-separated trailing counts (the {@link TagChip} `suffix`). */
	readonly suffix?: string
}

/**
 * Build a tag row's label split into chip name + dot-separated counts
 * suffix. A sibling member never renders its own name or counts — it
 * shows the "shows as <display>" badge; a display tag shows its group's
 * union counts (PRD 5.3).
 */
export function tagRowLabel(
	tag: TagWithCounts,
	kind: CatKind,
	group: TagSiblingGroup | undefined,
	displayName: string,
	t: TFunction,
): TagRowLabel {
	if (tag.displayTagId !== tag.id) {
		return { name: t("tags.rules.displaysAs", { name: displayName }) }
	}
	const line = tagLineLabel(effectiveTagCounts(tag, group), kind, t)
	const dotIndex = line.indexOf("·")
	if (dotIndex === -1) return { name: line }
	return {
		name: line.slice(0, dotIndex),
		suffix: line.slice(dotIndex + 1),
	}
}
