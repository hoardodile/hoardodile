import type { DocBlock, DocEditorInstance, DocPartialBlock } from "./schema.ts"

// The storage version is a content-shape constant shared with the diff
// machinery; re-exported here so the editor never imports it directly
// from the diff/content modules.
export { CURRENT_DOC_STORAGE_VERSION } from "../contentShape.ts"

export type HeadingInfo = {
	readonly id: string
	readonly level: number
	readonly text: string
}

function extractTextFromContent(content: unknown[]): string {
	let text = ""
	for (const item of content) {
		if (typeof item !== "object" || item === null) continue
		if (!("type" in item)) continue
		const typed = item as Record<string, unknown>
		if (typed.type === "text" && typeof typed.text === "string") {
			text += typed.text
		} else if (typed.type === "link" && Array.isArray(typed.content)) {
			for (const linkItem of typed.content) {
				if (
					typeof linkItem === "object" &&
					linkItem !== null &&
					"text" in linkItem &&
					typeof linkItem.text === "string"
				) {
					text += linkItem.text
				}
			}
		} else if (
			typed.type === "charChip" &&
			typeof typed.props === "object" &&
			typed.props !== null
		) {
			const props = typed.props as Record<string, unknown>
			if (
				typeof props.fallbackName === "string" &&
				props.fallbackName.length > 0
			) {
				text += props.fallbackName
			}
		} else if (
			typed.type === "resCard" &&
			typeof typed.props === "object" &&
			typed.props !== null
		) {
			const props = typed.props as Record<string, unknown>
			if (typeof props.resId === "string" && props.resId.length > 0) {
				text += `[${props.resId}]`
			}
		} else if (
			typed.type === "tagChip" &&
			typeof typed.props === "object" &&
			typed.props !== null
		) {
			const props = typed.props as Record<string, unknown>
			if (typeof props.text === "string" && props.text.length > 0) {
				text += props.text
			}
		}
	}
	return text
}

export function extractHeadings(blocks: readonly DocBlock[]): HeadingInfo[] {
	const headings: HeadingInfo[] = []
	function walk(items: readonly DocBlock[]) {
		for (const block of items) {
			if (block.type === "heading") {
				const content = Array.isArray(block.content) ? block.content : []
				headings.push({
					id: block.id,
					level: typeof block.props.level === "number" ? block.props.level : 1,
					text: extractTextFromContent(content),
				})
			}
			if (Array.isArray(block.children) && block.children.length > 0) {
				walk(block.children as DocBlock[])
			}
		}
	}
	walk(blocks)
	return headings
}

export type DocEditorHandle = {
	/** Get the plain-text representation of the current selection (empty if no range). */
	getSelectionText(): string
	/** Get the entire document as plain text. */
	getDocumentText(): string
	/** Replace the current selection with `text`; if there is no selection, insert at cursor. */
	replaceSelection(text: string): void
	/** Append `text` to the very end of the document on its own paragraph. */
	appendParagraph(text: string): void
	/** Stream-friendly: start a buffered insertion that successive calls can extend in place. */
	streamReplaceBegin(): void
	streamReplaceAppend(chunk: string): void
	streamReplaceEnd(): void
	/** Run the editor's undo step. */
	undo(): void
	/** Run the editor's redo step. */
	redo(): void
	/** Replace the entire document body with the given stored payload. */
	replaceContent(content: Record<string, unknown>): void
	/** Underlying BlockNote editor (for advanced cases). */
	editor: DocEditorInstance | undefined
}

/**
 * Build the imperative handle exposed by `DocEditor` so consumers can
 * manipulate selection/content without importing BlockNote directly.
 * A closure-captured `streamTo` cursor lets `streamReplaceAppend` extend
 * in place across many small chunks.
 */
export function buildEditorHandle(editor: DocEditorInstance): DocEditorHandle {
	let streamTo = 0
	return {
		editor,
		getSelectionText(): string {
			return editor.getSelectedText()
		},
		getDocumentText(): string {
			const { state } = editor._tiptapEditor
			return state.doc.textBetween(0, state.doc.content.size, "\n")
		},
		replaceSelection(text: string): void {
			editor.insertInlineContent([{ type: "text", text, styles: {} }])
		},
		appendParagraph(text: string): void {
			const blocks = editor.document
			const last = blocks[blocks.length - 1]
			const newBlock: DocPartialBlock = {
				type: "paragraph",
				content: [{ type: "text", text, styles: {} }],
			}
			if (last === undefined) {
				editor.replaceBlocks(editor.document, [newBlock])
				return
			}
			editor.insertBlocks([newBlock], last, "after")
		},
		streamReplaceBegin(): void {
			const tiptap = editor._tiptapEditor
			tiptap.commands.deleteSelection()
			streamTo = tiptap.state.selection.from
		},
		streamReplaceAppend(chunk: string): void {
			if (chunk.length === 0) return
			const tiptap = editor._tiptapEditor
			tiptap.commands.insertContentAt(streamTo, chunk, {
				updateSelection: false,
			})
			streamTo += chunk.length
		},
		streamReplaceEnd(): void {
			streamTo = 0
		},
		undo(): void {
			editor.undo()
		},
		redo(): void {
			editor.redo()
		},
		replaceContent(content: Record<string, unknown>): void {
			const blocks = normalizeInitialBlocks(content)
			editor.replaceBlocks(editor.document, blocks ?? [])
		},
	}
}

/**
 * Current document storage version. Written to every saved payload so future
 * code can detect the shape; no backward migrations are kept in this client.
 */

/**
 * Return the `blocks` array from a stored payload. Returns `undefined` so
 * BlockNote starts with one empty paragraph when the payload is missing or
 * malformed.
 */
export function normalizeInitialBlocks(
	value: Record<string, unknown> | undefined,
): DocPartialBlock[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value.blocks)) return undefined

	// BlockNote validates the block shape internally on initialContent;
	// at this trust boundary we accept the stored payload and let the
	// runtime surface block-shape errors directly to the user.
	return value.blocks as DocPartialBlock[]
}
