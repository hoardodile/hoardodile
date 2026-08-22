import { cn } from "@hoardodile/ui/lib/utils"
import { memo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { DocEditorInstance } from "../schema.ts"
import { ColorPickerToolbarButton } from "./ColorPickerToolbarButton.tsx"
import {
	AlignCenterIcon,
	AlignLeftIcon,
	AlignRightIcon,
	BoldIcon,
	CodeIcon,
	Heading1Icon,
	Heading2Icon,
	Heading3Icon,
	IndentDecreaseIcon,
	ItalicIcon,
	ListIcon,
	ListOrderedIcon,
	QuoteIcon,
	StrikethroughIcon,
	UnderlineIcon,
} from "./formatIcons.tsx"
import { LinkToolbarButton } from "./LinkToolbarButton.tsx"
import { TagChipToolbarButton } from "./TagChipToolbarButton.tsx"
import { ToolbarToggle } from "./ToolbarToggle.tsx"
import { applyTagChip, getActiveTagChipColor } from "./tagChipToolbar.ts"

export type EditorStaticToolbarProps = {
	readonly editor: DocEditorInstance
	readonly editable: boolean
}

type ToolbarState = {
	readonly blockId: string
	readonly blockType: string
	readonly headingLevel: 1 | 2 | 3 | undefined
	readonly blockAlign: "left" | "center" | "right" | undefined
	readonly indent: boolean | undefined
	readonly bold: boolean
	readonly italic: boolean
	readonly underline: boolean
	readonly strike: boolean
	readonly code: boolean
	readonly textColor: string | undefined
	readonly selectionEmpty: boolean
	readonly tagChipColor: string | undefined
}

function computeToolbarState(editor: DocEditorInstance): ToolbarState {
	const cursor = editor.getTextCursorPosition()
	const block = cursor.block
	const styles = editor.getActiveStyles() as Readonly<{
		bold?: boolean
		italic?: boolean
		underline?: boolean
		strike?: boolean
		code?: boolean
		textColor?: string
	}>
	const props =
		typeof block.props === "object" && block.props !== null
			? (block.props as { indent?: boolean; textAlignment?: string })
			: {}
	return {
		blockId: block.id,
		blockType: block.type,
		headingLevel: readHeadingLevel(block),
		blockAlign: readBlockAlign(block),
		indent: props.indent,
		bold: styles.bold === true,
		italic: styles.italic === true,
		underline: styles.underline === true,
		strike: styles.strike === true,
		code: styles.code === true,
		textColor: styles.textColor,
		selectionEmpty: editor._tiptapEditor.state.selection.empty,
		tagChipColor: getActiveTagChipColor(editor),
	}
}

function toolbarStateEquals(a: ToolbarState, b: ToolbarState): boolean {
	return (
		a.blockId === b.blockId &&
		a.blockType === b.blockType &&
		a.headingLevel === b.headingLevel &&
		a.blockAlign === b.blockAlign &&
		a.indent === b.indent &&
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.code === b.code &&
		a.textColor === b.textColor &&
		a.selectionEmpty === b.selectionEmpty &&
		a.tagChipColor === b.tagChipColor
	)
}

/**
 * Always-visible top toolbar rendered just above the BlockNote editor.
 *
 * - Subscribes to selection/content changes and only re-renders the button
 *   bar when the derived toolbar state (styles, block type, selection)
 *   actually changes.
 * - The floating BlockNote formatting toolbar is suppressed entirely;
 *   this static bar is the only formatting affordance.
 * - Mark toggles (bold / italic / underline / strike / code) and AI
 *   are disabled while the selection is collapsed because they have no
 *   meaningful target without a selection range.
 * - Block-level toggles (headings, lists) re-target the block under
 *   the current text-cursor and are always enabled, mirroring
 *   Notion-style editors that toggle the whole block in place.
 * - The bar wraps onto multiple rows on narrow viewports so every
 *   tool stays reachable without horizontal scrolling, and remains
 *   sticky to the top of the scroll container at every breakpoint.
 */
export function EditorStaticToolbar(props: EditorStaticToolbarProps) {
	const { editor, editable } = props
	const toolbarState = useEditorToolbarState(editor)
	if (!editable) return undefined
	return <ToolbarCore editor={editor} toolbarState={toolbarState} />
}

type ToolbarCoreProps = {
	readonly editor: DocEditorInstance
	readonly toolbarState: ToolbarState
}

const ToolbarCore = memo(function ToolbarCore(props: ToolbarCoreProps) {
	const { editor, toolbarState } = props
	const { t } = useTranslation()
	const {
		blockId,
		blockType,
		headingLevel,
		blockAlign,
		indent,
		bold,
		italic,
		underline,
		strike,
		code,
		textColor,
		selectionEmpty,
		tagChipColor,
	} = toolbarState

	function toggleStyle(
		name: "bold" | "italic" | "underline" | "strike" | "code",
	) {
		editor.toggleStyles({ [name]: true })
		editor.focus()
	}
	function toggleHeading(level: 1 | 2 | 3) {
		if (headingLevel === level) {
			editor.updateBlock(blockId, { type: "paragraph", props: {} })
		} else {
			editor.updateBlock(blockId, { type: "heading", props: { level } })
		}
		editor.focus()
	}
	function toggleList(type: "bulletListItem" | "numberedListItem") {
		if (blockType === type) {
			editor.updateBlock(blockId, { type: "paragraph", props: {} })
		} else {
			editor.updateBlock(blockId, { type, props: {} })
		}
		editor.focus()
	}
	function toggleQuote() {
		if (blockType === "quote") {
			editor.updateBlock(blockId, { type: "paragraph", props: {} })
		} else {
			editor.updateBlock(blockId, { type: "quote", props: {} })
		}
		editor.focus()
	}
	function toggleParagraphFirstLineIndent() {
		if (blockType !== "paragraph") return
		editor.updateBlock(blockId, {
			props: {
				indent: !(indent ?? true),
			},
		} as Parameters<typeof editor.updateBlock>[1])
		editor.focus()
	}
	function setAlignment(alignment: "left" | "center" | "right") {
		// `textAlignment` lives on the block props; flipping it on the
		// current block matches BlockNote's built-in alignment buttons.
		editor.updateBlock(blockId, {
			props: { textAlignment: alignment },
		} as Parameters<typeof editor.updateBlock>[1])
		editor.focus()
	}
	function applyTextColor(color: string) {
		if (color === "") {
			editor.removeStyles({ textColor: "" } as Record<string, string>)
		} else {
			editor.addStyles({ textColor: color } as Record<string, string>)
		}
		editor.focus()
	}
	function handleApplyTagChip(color: string) {
		applyTagChip(editor, color)
	}
	return (
		<div
			className={cn(
				"sticky z-21 -mx-5 flex flex-wrap items-center gap-x-0.5 gap-y-1 md:mx-0",
				// Header is in the document only at `sidebar:` (≥ `--breakpoint-sidebar`);
				// below that it portals into the shell topbar outside `<main>`.
				"max-sidebar:-top-0.5 sidebar:top-17 desktop-shell:max-sidebar:-top-1 desktop-shell:sidebar:top-9",
				"doc-toolbar rounded-none border-x-0 border-t-0 px-2 py-1.5",
			)}
			data-testid="document-static-toolbar"
		>
			<ToolbarToggle
				label={t("documents.toolbar.h1")}
				pressed={headingLevel === 1}
				onPressedChange={() => toggleHeading(1)}
				icon={<Heading1Icon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.h2")}
				pressed={headingLevel === 2}
				onPressedChange={() => toggleHeading(2)}
				icon={<Heading2Icon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.h3")}
				pressed={headingLevel === 3}
				onPressedChange={() => toggleHeading(3)}
				icon={<Heading3Icon className="size-4" />}
			/>
			<span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
			<ToolbarToggle
				label={t("documents.toolbar.bulletList")}
				pressed={blockType === "bulletListItem"}
				onPressedChange={() => toggleList("bulletListItem")}
				icon={<ListIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.orderedList")}
				pressed={blockType === "numberedListItem"}
				onPressedChange={() => toggleList("numberedListItem")}
				icon={<ListOrderedIcon className="size-4" />}
			/>
			<span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
			<ToolbarToggle
				label={t("documents.toolbar.bold")}
				pressed={bold}
				disabled={selectionEmpty}
				onPressedChange={() => toggleStyle("bold")}
				icon={<BoldIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.italic")}
				pressed={italic}
				disabled={selectionEmpty}
				onPressedChange={() => toggleStyle("italic")}
				icon={<ItalicIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("common.underline", { defaultValue: "Underline" })}
				pressed={underline}
				disabled={selectionEmpty}
				onPressedChange={() => toggleStyle("underline")}
				icon={<UnderlineIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.strike")}
				pressed={strike}
				disabled={selectionEmpty}
				onPressedChange={() => toggleStyle("strike")}
				icon={<StrikethroughIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.code")}
				pressed={code}
				disabled={selectionEmpty}
				onPressedChange={() => toggleStyle("code")}
				icon={<CodeIcon className="size-4" />}
			/>
			<span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
			<ToolbarToggle
				label={t("documents.toolbar.blockquote")}
				pressed={blockType === "quote"}
				onPressedChange={() => toggleQuote()}
				icon={<QuoteIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.noFirstLineIndent")}
				pressed={blockType === "paragraph" && indent === false}
				disabled={blockType !== "paragraph"}
				onPressedChange={() => toggleParagraphFirstLineIndent()}
				icon={<IndentDecreaseIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.alignLeft")}
				pressed={blockAlign === "left"}
				onPressedChange={() => setAlignment("left")}
				icon={<AlignLeftIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.alignCenter")}
				pressed={blockAlign === "center"}
				onPressedChange={() => setAlignment("center")}
				icon={<AlignCenterIcon className="size-4" />}
			/>
			<ToolbarToggle
				label={t("documents.toolbar.alignRight")}
				pressed={blockAlign === "right"}
				onPressedChange={() => setAlignment("right")}
				icon={<AlignRightIcon className="size-4" />}
			/>
			<ColorPickerToolbarButton
				label={t("documents.toolbar.textColor")}
				current={textColor}
				disabled={selectionEmpty}
				onPick={applyTextColor}
			/>
			<TagChipToolbarButton
				label={t("documents.toolbar.tagChip")}
				current={tagChipColor}
				disabled={selectionEmpty}
				onPick={handleApplyTagChip}
			/>
			<LinkToolbarButton
				label={t("documents.toolbar.link")}
				prompt={t("documents.toolbar.linkPrompt")}
				disabled={selectionEmpty}
				editor={editor}
			/>
		</div>
	)
})

export function readHeadingLevel(block: {
	type: string
	props?: unknown
}): 1 | 2 | 3 | undefined {
	if (block.type !== "heading") return undefined
	const props = block.props
	if (typeof props !== "object" || props === null) return undefined
	if (!("level" in props)) return undefined
	const { level } = props
	if (level === 1 || level === 2 || level === 3) return level
	return undefined
}

export function readBlockAlign(block: {
	props?: unknown
}): "left" | "center" | "right" | undefined {
	const props = block.props
	if (typeof props !== "object" || props === null) return undefined
	if (!("textAlignment" in props)) return undefined
	const { textAlignment } = props
	if (
		textAlignment === "left" ||
		textAlignment === "center" ||
		textAlignment === "right"
	) {
		return textAlignment
	}
	return undefined
}

/**
 * Tracks the BlockNote editor's selection and content changes and returns
 * a stable primitive toolbar state object. The toolbar only re-renders when
 * the derived state actually changes, so cursor movement without style
 * changes does not rebuild the whole button bar.
 */
function useEditorToolbarState(editor: DocEditorInstance): ToolbarState {
	const [state, setState] = useState<ToolbarState>(() =>
		computeToolbarState(editor),
	)
	useEffect(() => {
		function update() {
			setState((prev) => {
				const next = computeToolbarState(editor)
				return toolbarStateEquals(prev, next) ? prev : next
			})
		}
		const offChange = editor.onChange(update)
		const offSelection = editor.onSelectionChange(update)
		update()
		return () => {
			offChange?.()
			offSelection?.()
		}
	}, [editor])
	return state
}
