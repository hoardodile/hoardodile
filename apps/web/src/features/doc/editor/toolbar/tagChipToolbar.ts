import type { Node as PMNode } from "prosemirror-model"
import type { DocEditorInstance } from "../schema.ts"

export type ActiveTagChip = {
	readonly node: PMNode
	readonly pos: number
	readonly text: string
	readonly color: string
}

/**
 * Return the active `tagChip` inline node for the current selection.
 *
 * A chip is considered active when the selection spans exactly one chip node.
 */
export function getActiveTagChip(
	editor: DocEditorInstance,
): ActiveTagChip | undefined {
	const { state } = editor._tiptapEditor
	const { selection } = state

	const node = state.doc.nodeAt(selection.from)
	if (
		node !== null &&
		node !== undefined &&
		node.type.name === "tagChip" &&
		selection.from + node.nodeSize === selection.to
	) {
		return {
			node,
			pos: selection.from,
			text: (node.attrs.text as string) || "",
			color: (node.attrs.color as string) || "",
		}
	}

	return undefined
}

/**
 * Return the color of the active `tagChip`, or `undefined` when the selection
 * is not on a chip.
 */
export function getActiveTagChipColor(
	editor: DocEditorInstance,
): string | undefined {
	const chip = getActiveTagChip(editor)
	return chip?.color
}

/**
 * Apply, update, or remove a `tagChip` inline node for the current selection.
 *
 * - If the selection targets an existing chip, `color` updates it; an empty
 *   `color` removes the chip and restores its text as plain text.
 * - Otherwise the selected inline range is replaced by a new chip using the
 *   selection text.
 * - Empty color with no active chip is a no-op.
 */
export function applyTagChip(editor: DocEditorInstance, color: string): void {
	const { state } = editor._tiptapEditor
	const { selection } = state
	const tr = state.tr

	const activeChip = getActiveTagChip(editor)

	if (activeChip !== undefined) {
		if (color === "") {
			tr.replaceWith(
				activeChip.pos,
				activeChip.pos + activeChip.node.nodeSize,
				state.schema.text(activeChip.text),
			)
		} else {
			tr.setNodeMarkup(activeChip.pos, undefined, {
				...activeChip.node.attrs,
				color,
			})
		}
	} else if (!selection.empty && color !== "") {
		const tagChipType = state.schema.nodes.tagChip
		if (tagChipType !== undefined) {
			const text = editor.getSelectedText()
			tr.replaceSelectionWith(tagChipType.create({ text, color }))
		}
	}

	if (tr.docChanged) {
		editor._tiptapEditor.view.dispatch(tr)
	}
	editor.focus()
}
