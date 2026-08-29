import type { BlockNoteEditor } from "@blocknote/core"
import { createReactInlineContentSpec } from "@blocknote/react"
import { TagChip } from "@hoardodile/ui/components/tag-chip"
import { NodeSelection } from "prosemirror-state"
import type { MouseEvent } from "react"

/**
 * Inline `tagChip`: a rounded, tinted chip with fixed text content.
 *
 * It is implemented as a real inline node with `content: "none"` so the chip
 * behaves like an image/embed: it is not editable inside the document. The
 * label and color are supplied through an external popover input. Visuals are
 * delegated to {@link TagChip} so doc chips stay consistent with
 * standard tag chips elsewhere in the app.
 *
 * Clicking the chip selects it as a whole node so the toolbar popover can edit
 * or remove it.
 */
export const tagChipInlineSpec = createReactInlineContentSpec(
	{
		type: "tagChip",
		propSchema: {
			color: { default: "" },
			text: { default: "" },
		},
		content: "none",
	},
	{
		render: ({ inlineContent, editor }) => {
			const { color, text } = inlineContent.props
			return (
				<TagChip
					color={color}
					className="align-text-top cursor-pointer indent-0 transition-shadow hover:ring-2 hover:ring-primary/30 text-[0.625em] md:text-xs"
					onMouseDown={(event) => handleChipMouseDown(event, editor)}
				>
					{text}
				</TagChip>
			)
		},
		toExternalHTML: ({ inlineContent }) => {
			const { color, text } = inlineContent.props
			return <TagChip color={color}>{text}</TagChip>
		},
	},
)

export function handleChipMouseDown(
	event: Pick<MouseEvent<HTMLSpanElement>, "currentTarget" | "preventDefault">,
	editor: BlockNoteEditor<any, any, any>,
): void {
	const target = event.currentTarget
	const view = editor._tiptapEditor.view
	let pos = view.posAtDOM(target, 0)
	let node = view.state.doc.nodeAt(pos)
	if (node?.type.name !== "tagChip") {
		pos = pos - 1
		node = view.state.doc.nodeAt(pos)
	}
	if (node?.type.name !== "tagChip") return
	event.preventDefault()
	const tr = view.state.tr
	tr.setSelection(NodeSelection.create(view.state.doc, pos))
	view.dispatch(tr)
	view.focus()
}
