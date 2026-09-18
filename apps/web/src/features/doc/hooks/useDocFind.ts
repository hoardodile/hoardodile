import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import type { DocFindBarProps } from "../components/DocFindBar.tsx"
import type { DocEditorInstance } from "../editor/schema.ts"
import {
	CLASS_ACTIVE_MATCH,
	getDocSearchExtension,
} from "../editor/search/docSearchExtension.ts"
import { findMatches, type MatchRange } from "../editor/search/findMatches.ts"
import { replaceRanges } from "../editor/search/replaceMatches.ts"

/** Stable identity for "no matches" so the decoration push is idempotent. */
const NO_MATCHES: readonly MatchRange[] = []

export type UseDocFindInput = {
	/** The live main editor; `undefined` while it is unmounted (diff mode). */
	readonly editor: DocEditorInstance | undefined
	readonly docId: string
	/** Preview / reading / recycle-bin views: search only, no replacing. */
	readonly readOnly: boolean
}

export type UseDocFindResult = {
	readonly open: boolean
	readonly bar: DocFindBarProps
	readonly openFind: () => void
	/** Open and put the caret in the replacement field (Ctrl+H). */
	readonly openReplace: () => void
	readonly closeFind: () => void
}

/**
 * Find & replace state for one document body.
 *
 * React owns the query, the match list and the active match; the editor's
 * search extension only renders the highlights it is handed, which keeps a
 * single source of truth and lets the matching logic stay a pure function
 * over the ProseMirror document.
 *
 * Replacements are ordinary document transactions, so they are undoable in
 * one step and flow through the existing draft/autosave pipeline.
 */
export function useDocFind(input: UseDocFindInput): UseDocFindResult {
	const { editor, docId, readOnly } = input
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [replacement, setReplacement] = useState("")
	const [caseSensitive, setCaseSensitive] = useState(false)
	// The replace row starts collapsed (one-line widget, VS Code style) and
	// is remembered per session; Ctrl+H expands it.
	const [replaceOpen, setReplaceOpen] = useState(false)
	const [activeIndex, setActiveIndex] = useState(0)
	// Bumped by the editor's change event so the memo below re-reads the
	// document; the doc itself is not a React value.
	const [docEpoch, setDocEpoch] = useState(0)
	const inputRef = useRef<HTMLInputElement | null>(null)
	const replacementRef = useRef<HTMLInputElement | null>(null)
	const [focusTarget, setFocusTarget] = useState<"query" | "replacement">(
		"query",
	)

	// A new document is a new search.
	useEffect(
		function resetForDocument() {
			setOpen(false)
			setQuery("")
			setReplacement("")
			setCaseSensitive(false)
			setReplaceOpen(false)
			setActiveIndex(0)
		},
		[docId],
	)

	useEffect(
		function watchDocumentChanges() {
			if (editor === undefined) return
			// Fires only on document changes (never on meta-only
			// transactions), so pushing highlights cannot loop back here.
			return editor.onChange(() => setDocEpoch((epoch) => epoch + 1))
		},
		[editor],
	)

	const matches = useMemo(() => {
		if (editor === undefined || !open) return NO_MATCHES
		return findMatches(editor.prosemirrorView.state.doc, query, {
			caseSensitive,
		})
		// `docEpoch` is the document's version key: the editor mutates its
		// state in place, so changes must be pulled in by dependency.
	}, [editor, open, query, caseSensitive, docEpoch])

	const active =
		matches.length === 0
			? -1
			: Math.min(Math.max(activeIndex, 0), matches.length - 1)

	useLayoutEffect(
		function publishHighlights() {
			if (editor === undefined) return
			getDocSearchExtension(editor)?.setRanges(open ? matches : [], active)
		},
		[editor, open, matches, active],
	)

	const activeRange = active >= 0 ? matches[active] : undefined
	useLayoutEffect(
		function revealActiveMatch() {
			if (!open || editor === undefined || activeRange === undefined) return
			editor.prosemirrorView.dom
				.querySelector(`.${CLASS_ACTIVE_MATCH}`)
				?.scrollIntoView({ block: "center" })
		},
		// Re-centre only when the active match actually moves, not on every
		// recomputation (a keystroke elsewhere in the body must not yank the
		// reader's scroll position).
		[editor, open, activeRange?.from, activeRange?.to],
	)

	useEffect(
		function focusField() {
			if (!open) return
			const target =
				focusTarget === "replacement"
					? replacementRef.current
					: inputRef.current
			target?.focus()
		},
		[open, focusTarget],
	)

	const openFind = useCallback(function openFind() {
		setFocusTarget("query")
		setOpen(true)
		// Already open (Ctrl+F again): the effect above will not re-run.
		inputRef.current?.focus()
	}, [])

	const openReplace = useCallback(function openReplace() {
		setFocusTarget("replacement")
		setReplaceOpen(true)
		setOpen(true)
		replacementRef.current?.focus()
	}, [])

	const closeFind = useCallback(
		function closeFind() {
			setOpen(false)
			editor?.prosemirrorView.focus()
		},
		[editor],
	)

	const changeQuery = useCallback(function changeQuery(value: string) {
		setQuery(value)
		// A new query restarts the walk from the first match.
		setActiveIndex(0)
	}, [])

	const goToNext = useCallback(
		function goToNext() {
			if (matches.length === 0) return
			setActiveIndex((active + 1) % matches.length)
		},
		[matches.length, active],
	)

	const goToPrevious = useCallback(
		function goToPrevious() {
			if (matches.length === 0) return
			setActiveIndex((active - 1 + matches.length) % matches.length)
		},
		[matches.length, active],
	)

	const replaceCurrent = useCallback(
		function replaceCurrent() {
			if (readOnly || editor === undefined) return
			const range = matches[active]
			if (range === undefined) return
			replaceRanges(editor, [range], replacement)
		},
		[readOnly, editor, matches, active, replacement],
	)

	const replaceAll = useCallback(
		function replaceAll() {
			if (readOnly || editor === undefined) return
			replaceRanges(editor, matches, replacement)
		},
		[readOnly, editor, matches, replacement],
	)

	// The bar keeps focus while the user replaces, so the browser's Ctrl+Z
	// never reaches the editor: route it there explicitly. One replace —
	// or one replace-all — stays a single history step.
	const undo = useCallback(
		function undo() {
			editor?.undo()
		},
		[editor],
	)

	const redo = useCallback(
		function redo() {
			editor?.redo()
		},
		[editor],
	)

	const bar: DocFindBarProps = {
		query,
		replacement,
		caseSensitive,
		currentIndex: active >= 0 ? active + 1 : 0,
		total: matches.length,
		replaceOpen,
		readOnly,
		inputRef,
		replacementRef,
		onQueryChange: changeQuery,
		onReplacementChange: setReplacement,
		onToggleCase: () => setCaseSensitive((value) => !value),
		onToggleReplace: () => setReplaceOpen((value) => !value),
		onNext: goToNext,
		onPrevious: goToPrevious,
		onReplace: replaceCurrent,
		onReplaceAll: replaceAll,
		onUndo: undo,
		onRedo: redo,
		onClose: closeFind,
	}

	return { open, bar, openFind, openReplace, closeFind }
}
