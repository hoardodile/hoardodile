import {
	BlockNoteSchema,
	defaultBlockSpecs,
	defaultInlineContentSpecs,
	defaultStyleSpecs,
} from "@blocknote/core"
import { charChipInlineSpec } from "./CharChipInline.tsx"
import { createDocParagraphBlockSpec } from "./docParagraphBlock.ts"
import { resCardInlineSpec } from "./ResCardInline.tsx"
import { tagChipInlineSpec } from "./TagChipInline.tsx"
import { textColorStyleSpec } from "./textColorStyleSpec.tsx"

/**
 * Project-specific BlockNote schema.
 *
 * - Inline `charChip`: lightweight @-style mention rendered with
 *   the character's avatar + name; opens the character detail route on
 *   click.
 * - Inline `resCard`: bare resource thumbnail tile (cover + media
 *   corner pills) embedded alongside text.
 * - Inline `tagChip`: rounded, tinted chip with fixed text content. Behaves
 *   like an image/embed (not editable inline); the label and color are set
 *   through the toolbar popover.
 * - Paragraph blocks support `indent` (default true) for per-block
 *   opt-out from document-level first-line indent styling when set false.
 *
 * Both are inserted via the slash menu (see `slashMenuItems.tsx`) so
 * the user never has to hand-author the JSON shape.
 */
export const docSchema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		paragraph: createDocParagraphBlockSpec(),
	},
	inlineContentSpecs: {
		...defaultInlineContentSpecs,
		charChip: charChipInlineSpec,
		resCard: resCardInlineSpec,
		tagChip: tagChipInlineSpec,
	},
	styleSpecs: {
		...defaultStyleSpecs,
		textColor: textColorStyleSpec,
	},
})

export type DocBlock = typeof docSchema.Block
export type DocPartialBlock = typeof docSchema.PartialBlock
export type DocEditorInstance = typeof docSchema.BlockNoteEditor
