import type { CatKind } from "@hoardodile/schemas"
import type { TFunction } from "i18next"
import type { TagWithCounts } from "../panelModel"

/**
 * Build a middle-dot-separated label for a tag chip in the category panel.
 * Includes resource and/or character counts depending on the category kind.
 */
export function tagLineLabel(
	tag: TagWithCounts,
	kind: CatKind,
	t: TFunction,
): string {
	const parts: string[] = [tag.name]
	if (kind === "common" || kind === "resource")
		parts.push(t("categories.panel.tagResourceCount", { count: tag.resCount }))
	if (kind === "common" || kind === "character")
		parts.push(
			t("categories.panel.tagCharacterCount", { count: tag.charCount }),
		)
	return parts.join("·")
}
