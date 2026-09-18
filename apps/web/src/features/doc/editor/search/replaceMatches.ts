import type { Mark, Node } from "prosemirror-model"
import type { EditorState, Transaction } from "prosemirror-state"
import type { DocEditorInstance } from "../schema.ts"
import type { MatchRange } from "./findMatches.ts"

/**
 * Marks to give the replacement text: the marks of the text node the match
 * lives in. Reading them off that node (rather than off the position) keeps
 * formatting intact even when a match starts exactly at a styled span's
 * boundary, where position marks would report the neighbour's.
 */
function marksAtMatchStart(doc: Node, from: number): readonly Mark[] {
	const $from = doc.resolve(from)
	const node = $from.nodeAfter
	if (node?.isText) return node.marks
	return $from.marks()
}

/**
 * Build the single transaction that replaces every range with
 * `replacement`.
 *
 * Ranges are applied right-to-left so earlier positions stay valid while
 * the transaction is built; the replacement text inherits the marks of the
 * text it replaces (bold, link, text color …), so a replace inside
 * formatted text stays formatted. An empty replacement deletes the match.
 * Every range must come from {@link findMatches} — they are
 * single-text-node ranges, which is what `replaceWith` can consume without
 * splitting nodes.
 */
export function buildReplaceTransaction(
	state: EditorState,
	ranges: readonly MatchRange[],
	replacement: string,
): Transaction {
	const tr = state.tr
	const ordered = [...ranges].sort((a, b) => b.from - a.from)
	for (const range of ordered) {
		if (replacement.length === 0) {
			tr.delete(range.from, range.to)
			continue
		}
		tr.replaceWith(
			range.from,
			range.to,
			state.schema.text(replacement, marksAtMatchStart(state.doc, range.from)),
		)
	}
	return tr
}

/**
 * Replace `ranges` in the live editor as one undoable step. Dispatching a
 * normal document transaction keeps the rest of the pipeline intact: the
 * editor's change event fires once, so the draft state machine marks the
 * document dirty and the autosave debounce picks the edit up.
 */
export function replaceRanges(
	editor: DocEditorInstance,
	ranges: readonly MatchRange[],
	replacement: string,
): void {
	if (ranges.length === 0) return
	const view = editor.prosemirrorView
	const tr = buildReplaceTransaction(view.state, ranges, replacement)
	if (!tr.docChanged) return
	view.dispatch(tr)
}
