import { filterSuggestionItems } from "@blocknote/core"
import {
	de as blocknoteDe,
	en as blocknoteEn,
	es as blocknoteEs,
	ja as blocknoteJa,
	zh as blocknoteZh,
} from "@blocknote/core/locales"
import {
	type DefaultReactSuggestionItem,
	getDefaultReactSlashMenuItems,
	SuggestionMenuController,
	useCreateBlockNote,
} from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"
import "@blocknote/shadcn/style.css"
import { useBelowMd } from "@hoardodile/ui/hooks/use-mobile"
import { Box, User } from "@hoardodile/ui/icons/registry"
import { useQueryClient } from "@tanstack/react-query"
import { redoDepth, undoDepth } from "prosemirror-history"
import {
	type Ref,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/common/ThemeProvider"
import { charListCardsQueryOptions } from "@/features/char/api"
import { CharSelectorDialog } from "@/features/char/components/CharSelectorDialog"
import { CharThumb } from "@/features/char/components/CharThumb"
import { ResSelectorDialog } from "@/features/res/components/ResSelectorDialog"
import {
	buildEditorHandle,
	CURRENT_DOC_STORAGE_VERSION,
	type DocEditorHandle,
	extractHeadings,
	normalizeInitialBlocks,
} from "./handle.ts"
import { type DocBlock, docSchema } from "./schema.ts"

import { EditorStaticToolbar } from "./toolbar/EditorStaticToolbar.tsx"

export type DocEditorProps = {
	/** Stored content as a BlockNote `{blocks}` payload. */
	readonly value: Record<string, unknown> | undefined
	readonly editable?: boolean
	readonly placeholder?: string
	/** Called with a BlockNote `{blocks}` payload whenever the document mutates. */
	readonly onChange?: (content: Record<string, unknown>) => void
	/**
	 * Fired with the editor's current undo/redo availability whenever a
	 * transaction lands. Mirrors tiptap's `editor.can().undo()` /
	 * `.redo()` so the toolbar can grey out buttons that have no work
	 * to do.
	 */
	readonly onHistoryChange?: (state: {
		readonly canUndo: boolean
		readonly canRedo: boolean
	}) => void
	/** Called with the current heading list whenever the document mutates. */
	readonly onHeadingsChange?: (
		headings: {
			readonly id: string
			readonly level: number
			readonly text: string
		}[],
	) => void
	/** Called with the plain-text character count whenever the document mutates. */
	readonly onCharCountChange?: (count: number) => void
	readonly handleRef?: Ref<DocEditorHandle>
	/**
	 * Fired once after the BlockNote editor instance is ready.
	 * Return a cleanup function to run when the editor unmounts.
	 */
	readonly onReady?: () => (() => void) | undefined
}

/**
 * BlockNote-backed editor for document bodies.
 *
 * - Storage shape is `{ version: 3, blocks: PartialBlock[] }`.
 * - The slash / `@` menus surface a single "Insert character" or
 *   "Insert resource" entry that opens the same picker dialog used on
 *   the management pages. `#` runs a live character name search (same
 *   query as the character list) and offers matches as suggestions,
 *   plus the same picker shortcuts at the bottom of the menu.
 * - Side-menu (drag handle) animations are disabled so the handle
 *   appears instantly on hover.
 * - Imperative handle exposes selection text, document text,
 *   replace-selection, append, and a tiny "stream into selection" buffer.
 */
/** BlockNote's built-in UI dictionary per app language — English fallback
 *  for anything not listed (BlockNote 0.51.x ships these five). */
const BLOCKNOTE_DICTIONARY: Record<string, typeof blocknoteEn> = {
	en: blocknoteEn,
	zh: blocknoteZh,
	ja: blocknoteJa,
	de: blocknoteDe,
	es: blocknoteEs,
}

export function DocEditor(props: DocEditorProps) {
	const editable = props.editable !== false
	const { resolvedTheme } = useTheme()
	const { t, i18n } = useTranslation()
	const isBelowMd = useBelowMd()
	const initialBlocks = useMemo(
		() => normalizeInitialBlocks(props.value),
		// Captured at mount; switching documents must remount via `key`.
		[],
	)
	const dictionary = useMemo(() => {
		const base =
			BLOCKNOTE_DICTIONARY[i18n.resolvedLanguage ?? "en"] ?? blocknoteEn
		return {
			...base,
			placeholders: {
				...base.placeholders,
				default: t("documents.editorPlaceholder"),
			},
		}
	}, [i18n.resolvedLanguage, t])
	const editor = useCreateBlockNote({
		schema: docSchema,
		initialContent: initialBlocks,
		animations: false,
		dictionary,
	})

	const queryClient = useQueryClient()
	const [pickerKind, setPickerKind] = useState<
		"character" | "resource" | undefined
	>(undefined)

	useImperativeHandle(
		props.handleRef,
		(): DocEditorHandle => buildEditorHandle(editor),
		[editor],
	)

	const onChangeRef = useRef(props.onChange)
	const onHistoryChangeRef = useRef(props.onHistoryChange)
	const onHeadingsChangeRef = useRef(props.onHeadingsChange)
	const onCharCountChangeRef = useRef(props.onCharCountChange)
	const onReadyRef = useRef(props.onReady)
	onChangeRef.current = props.onChange
	onHistoryChangeRef.current = props.onHistoryChange
	onHeadingsChangeRef.current = props.onHeadingsChange
	onCharCountChangeRef.current = props.onCharCountChange
	onReadyRef.current = props.onReady
	const charCountTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	)

	useEffect(() => {
		const cleanup = onReadyRef.current?.()
		return () => {
			if (typeof cleanup === "function") cleanup()
		}
	}, [editor])

	useEffect(() => {
		function readHistory() {
			const tiptap = editor._tiptapEditor
			// `editor.can().undo()` / `.redo()` are contributed by the
			// tiptap history extension at runtime, but BlockNote does not
			// re-export the CanCommands type augmentation. Read the
			// underlying ProseMirror history plugin's depth fields
			// directly — they're stable and declared on the public API.
			return {
				canUndo: undoDepth(tiptap.state) > 0,
				canRedo: redoDepth(tiptap.state) > 0,
			}
		}
		function readCharCount(): number {
			const { state } = editor._tiptapEditor
			return state.doc.textBetween(0, state.doc.content.size, "\n").length
		}
		function notifyHeadings() {
			onHeadingsChangeRef.current?.(extractHeadings(editor.document))
		}
		function notifyCharCount() {
			if (charCountTimerRef.current !== undefined) {
				clearTimeout(charCountTimerRef.current)
			}
			charCountTimerRef.current = setTimeout(() => {
				charCountTimerRef.current = undefined
				onCharCountChangeRef.current?.(readCharCount())
			}, 300)
		}
		onHistoryChangeRef.current?.(readHistory())
		// Headings drive the right-hand navigation sidebar and should stay
		// synchronous so it appears immediately. Character count is only
		// for the status bar and remains debounced.
		notifyHeadings()
		notifyCharCount()
		const off = editor.onChange(() => {
			onChangeRef.current?.({
				version: CURRENT_DOC_STORAGE_VERSION,
				blocks: editor.document,
			})
			onHistoryChangeRef.current?.(readHistory())
			notifyHeadings()
			notifyCharCount()
		})
		return () => {
			if (charCountTimerRef.current !== undefined) {
				clearTimeout(charCountTimerRef.current)
				charCountTimerRef.current = undefined
			}
			off?.()
		}
	}, [editor])

	const charPickerItem: DefaultReactSuggestionItem = useMemo(
		() => ({
			title: t("documents.slash.insertCharacter"),
			group: t("documents.slash.charactersGroup"),
			icon: <User className="size-4" />,
			onItemClick: () => setPickerKind("character"),
		}),
		[t],
	)
	const resPickerItem: DefaultReactSuggestionItem = useMemo(
		() => ({
			title: t("documents.slash.insertResource"),
			group: t("documents.slash.resourcesGroup"),
			icon: <Box className="size-4" />,
			onItemClick: () => setPickerKind("resource"),
		}),
		[t],
	)

	const getHashMenuItems = useCallback(
		async (query: string) => {
			const staticItems = filterSuggestionItems(
				[charPickerItem, resPickerItem],
				query,
			)
			try {
				const { rows } = await queryClient.fetchQuery(
					charListCardsQueryOptions({
						query: query.trim(),
						page: 1,
						trash: false,
					}),
				)
				const charItems: DefaultReactSuggestionItem[] = rows
					.slice(0, 12)
					.map((row) => ({
						title: row.name,
						group: t("documents.slash.charactersGroup"),
						icon: (
							<CharThumb
								charId={row.id}
								variant="avatar"
								cacheKey={row.updatedAt}
								name={row.name}
								hoverOverlay={false}
								className="size-8 shrink-0 rounded-full overflow-hidden"
							/>
						),
						onItemClick: () => {
							editor.insertInlineContent([
								{
									type: "charChip",
									props: { charId: row.id, fallbackName: row.name },
								},
								" ",
							])
						},
					}))
				return [...charItems, ...staticItems]
			} catch {
				return staticItems
			}
		},
		[charPickerItem, editor, queryClient, resPickerItem, t],
	)

	function handleCharacterSelected(id: string) {
		setPickerKind(undefined)
		editor.insertInlineContent([
			{ type: "charChip", props: { charId: id, fallbackName: "" } },
			" ",
		])
	}

	function handleResourceSelected(id: string) {
		setPickerKind(undefined)
		editor.insertInlineContent([{ type: "resCard", props: { resId: id } }, " "])
	}

	return (
		<>
			<EditorStaticToolbar editor={editor} editable={editable} />
			<BlockNoteView
				editor={editor}
				editable={editable}
				theme={resolvedTheme}
				slashMenu={false}
				formattingToolbar={false}
				sideMenu={editable && !isBelowMd}
			>
				<SuggestionMenuController
					triggerCharacter="/"
					getItems={async (query) =>
						filterSuggestionItems(
							[
								charPickerItem,
								resPickerItem,
								...getDefaultReactSlashMenuItems(editor),
							],
							query,
						)
					}
				/>
				<SuggestionMenuController
					triggerCharacter="@"
					getItems={(query) =>
						Promise.resolve(filterSuggestionItems([charPickerItem], query))
					}
				/>
				<SuggestionMenuController
					triggerCharacter="#"
					getItems={getHashMenuItems}
				/>
			</BlockNoteView>
			<CharSelectorDialog
				mode="single"
				open={pickerKind === "character"}
				onSelect={handleCharacterSelected}
				onOpenChange={(next) => {
					if (!next) setPickerKind(undefined)
				}}
			/>
			<ResSelectorDialog
				mode="single"
				open={pickerKind === "resource"}
				onSelect={handleResourceSelected}
				onOpenChange={(next) => {
					if (!next) setPickerKind(undefined)
				}}
			/>
		</>
	)
}

export type { DocBlock, DocEditorHandle }
