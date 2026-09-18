import { createExtension, createStore } from "@blocknote/core"
import type { Node } from "prosemirror-model"
import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import type { DocEditorInstance } from "../schema.ts"
import type { MatchRange } from "./findMatches.ts"

export const DOC_SEARCH_EXTENSION_KEY = "docSearch"

const docSearchKey = new PluginKey<DecorationSet>("docSearchDecorations")

/** Match ranges plus which one is the active (scrolled-to) match. */
export type DocSearchDecorations = {
	readonly ranges: readonly MatchRange[]
	readonly activeIndex: number
}

export const CLASS_MATCH = "doc-search-match"
export const CLASS_ACTIVE_MATCH = "doc-search-match-active"

/**
 * Build the highlight decorations for a payload. Positions arrive from
 * React, which computed them against a document the editor may already
 * have moved past: anything out of range (or degenerate) is dropped, and a
 * rejected decoration set degrades to "no highlights" instead of throwing
 * inside ProseMirror's render pass.
 */
function buildDecorations(
	doc: Node,
	payload: DocSearchDecorations,
): DecorationSet {
	const size = doc.content.size
	const decorations: Decoration[] = []
	payload.ranges.forEach((range, index) => {
		if (range.from < 0 || range.from >= range.to || range.to > size) return
		const active = index === payload.activeIndex
		decorations.push(
			Decoration.inline(range.from, range.to, {
				class: active ? `${CLASS_MATCH} ${CLASS_ACTIVE_MATCH}` : CLASS_MATCH,
			}),
		)
	})
	if (decorations.length === 0) return DecorationSet.empty
	try {
		return DecorationSet.create(doc, decorations)
	} catch {
		return DecorationSet.empty
	}
}

/**
 * In-document search highlighting.
 *
 * The extension owns exactly one thing: a decoration set for the ranges
 * `useDocFind` hands it. React stays the single source of truth for the
 * query, the matches and the active index; this plugin is a renderer that
 * rebuilds on the pushed payload and otherwise maps its highlights through
 * document changes, so a highlight never outlives the text it marked.
 */
export const docSearchExtension = createExtension(({ editor }) => {
	const store = createStore<DocSearchDecorations>(
		{ ranges: [], activeIndex: 0 },
		{
			onUpdate() {
				// A meta-only transaction (no document change), so this never
				// re-enters the change pipeline that feeds the search state.
				editor.transact((tr) => tr.setMeta(docSearchKey, store.state))
			},
		},
	)

	return {
		key: DOC_SEARCH_EXTENSION_KEY,
		store,
		prosemirrorPlugins: [
			new Plugin<DecorationSet>({
				key: docSearchKey,
				state: {
					init: () => DecorationSet.empty,
					apply: (tr, previous, _oldState, newState) => {
						const payload = tr.getMeta(docSearchKey) as
							| DocSearchDecorations
							| undefined
						if (payload !== undefined) {
							return buildDecorations(newState.doc, payload)
						}
						if (tr.docChanged) return previous.map(tr.mapping, tr.doc)
						return previous
					},
				},
				props: {
					decorations: (state) =>
						docSearchKey.getState(state) ?? DecorationSet.empty,
				},
			}),
		],
		/** Point the highlights at `ranges` (empty to clear them). */
		setRanges(ranges: readonly MatchRange[], activeIndex: number): void {
			store.setState({ ranges: [...ranges], activeIndex })
		},
	} as const
})

/**
 * The search extension instance registered on `editor`, when present.
 * `getExtension` is BlockNote's typed lookup by factory, so callers get the
 * `setRanges` method without narrowing the untyped extension map.
 */
export function getDocSearchExtension(editor: DocEditorInstance) {
	return editor.getExtension(docSearchExtension)
}
