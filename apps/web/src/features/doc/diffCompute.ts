import { blockToNode } from "@blocknote/core"
import { transformToSuggestionTransaction } from "@handlewithcare/prosemirror-suggest-changes"
import { isEqual } from "es-toolkit"
import { ChangeSet } from "prosemirror-changeset"
import type { Node, Schema } from "prosemirror-model"
import { Fragment, Slice } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { StepMap } from "prosemirror-transform"
import type { DocEditorInstance } from "./editor/schema.ts"

/** Loose BlockNote block shape used for diff input/output. */
export type DiffableBlock = Record<string, unknown>

export function blocksToDoc(
	schema: Schema,
	blocks: readonly DiffableBlock[],
): Node {
	const safeBlocks = blocks.length > 0 ? blocks : [{ type: "paragraph" }]
	const blockNodes = safeBlocks.map((block) =>
		blockToNode(block as Parameters<typeof blockToNode>[0], schema),
	)
	const blockGroup = schema.nodes.blockGroup!.createChecked({}, blockNodes)
	return schema.nodes.doc!.createChecked({}, blockGroup)
}

/**
 * Compute a ProseMirror document that renders the difference between
 * `baseBlocks` and `currentBlocks` using the same `insertion`/`deletion`
 * suggestion marks that BlockNote's AI extension uses.
 *
 * Returns `undefined` when the two documents are structurally identical,
 * otherwise a ProseMirror Node that can be applied to a read-only DocEditor.
 */
export function computeInlineDiffDoc(
	editor: DocEditorInstance,
	baseBlocks: readonly DiffableBlock[],
	currentBlocks: readonly DiffableBlock[],
): Node | undefined {
	if (contentEquals(baseBlocks, currentBlocks)) {
		return undefined
	}

	const schema = editor._tiptapEditor.state.schema
	const baseDoc = blocksToDoc(schema, baseBlocks)
	const currentDoc = blocksToDoc(schema, currentBlocks)

	const baseState = EditorState.create({ schema, doc: baseDoc })

	// Ask prosemirror-changeset to compare the two whole documents. Passing a
	// single StepMap that maps the entire base doc onto the current doc lets
	// ChangeSet.computeDiff break the replacement into smaller changed regions.
	const changeSet = ChangeSet.create(baseDoc).addSteps(
		currentDoc,
		[new StepMap([0, baseDoc.content.size, currentDoc.content.size])],
		0,
	)

	// Apply the detected changes as individual replace steps so that
	// transformToSuggestionTransaction can turn each region into inline
	// insertion/deletion marks instead of treating the whole doc as one change.
	const tr = baseState.tr
	const changes = [...changeSet.changes].sort((a, b) => b.fromA - a.fromA)
	for (const change of changes) {
		const slice = currentDoc.slice(change.fromB, change.toB)
		tr.replace(change.fromA, change.toA, slice)
	}

	const suggestionTr = transformToSuggestionTransaction(tr, baseState)
	const diffState = baseState.apply(suggestionTr)
	return diffState.doc
}

/**
 * Replace the editor's whole document with `doc` without recording it in
 * history — used to drop a computed diff into the read-only twin editor.
 */
export function applyDiffDoc(editor: DocEditorInstance, doc: Node): void {
	const tiptap = editor._tiptapEditor
	const tr = tiptap.state.tr
	tr.replace(0, tr.doc.content.size, new Slice(Fragment.from(doc), 0, 0))
	tiptap.view.dispatch(tr.setMeta("addToHistory", false))
}

function contentEquals(
	a: readonly DiffableBlock[],
	b: readonly DiffableBlock[],
): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (!isEqual(a[i], b[i])) return false
	}
	return true
}
