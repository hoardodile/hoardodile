import { MAX_DOC_CONTENT_TEXT_LENGTH } from "@hoardodile/schemas"

import { toast } from "@hoardodile/ui/components/toast"
import type { QueryClient } from "@tanstack/react-query"
import { isEqual } from "es-toolkit"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { DocEditorHandle } from "../editor/DocEditor"
import { invalidateDocuments } from "../index.ts"
import { useDocAutosave } from "./useDocAutosave"
import { useDocDraftMutations } from "./useDocDraftMutations"

export type DocDraftInput = {
	readonly id: string
	readonly draft:
		| Readonly<{
				title: string
				content: Record<string, unknown>
				updatedAt: number
		  }>
		| undefined
	readonly autosaveEnabled: boolean
	readonly latestVersionAt: number | undefined
	readonly editorHandleRef: React.RefObject<DocEditorHandle | null>
	readonly qc: QueryClient
}

export type DocDraft = {
	readonly titleInput: string
	readonly setTitleInput: (next: string) => void
	readonly dirty: boolean
	readonly hasCommittableChange: boolean
	readonly canUndo: boolean
	readonly canRedo: boolean
	readonly charCount: number
	readonly charCountOverLimit: boolean
	readonly onCharCountChange: (count: number) => void
	readonly setHistoryFlags: (flags: {
		canUndo: boolean
		canRedo: boolean
	}) => void
	readonly onContentChange: (content: Record<string, unknown>) => void
	readonly flushPendingContent: () => void
	readonly manualSave: () => void
	readonly manualSaveAsync: () => Promise<void>
	readonly discardUnsaved: () => void
	readonly requestCommit: (openDialog: () => void) => void
	readonly submitCommit: (message: string, onSuccess: () => void) => void
	readonly confirmDiscard: (onSuccess: () => void) => void
	readonly patchPending: boolean
	readonly commitPending: boolean
	readonly discardPending: boolean
}

/**
 * Owns the draft-side state machine for a document detail route.
 *
 * When the user tries to leave the current document with unsaved changes, the
 * route-level leave guard asks whether to save or discard them.
 */
export function useDocDraft(args: DocDraftInput): DocDraft {
	const { id, draft, autosaveEnabled, latestVersionAt, editorHandleRef, qc } =
		args
	const { t } = useTranslation()
	// Seed the title from the draft synchronously so the first paint shows
	// the real title instead of the "Untitled" placeholder (the sync effect
	// below runs after paint).
	const [titleInput, setTitleInputRaw] = useState<string>(
		() => draft?.title ?? "",
	)
	// Adjust state during render when the document identity changes: the
	// route component survives param changes, so without this the title
	// would show the previous document's title for a frame.
	const [syncedDocId, setSyncedDocId] = useState(id)
	if (syncedDocId !== id) {
		setSyncedDocId(id)
		setTitleInputRaw(draft?.title ?? "")
	}
	const [contentDirty, setContentDirty] = useState(false)
	const [canUndo, setCanUndo] = useState(false)
	const [canRedo, setCanRedo] = useState(false)
	const [charCount, setCharCount] = useState(0)

	const currentDocIdRef = useRef(id)
	currentDocIdRef.current = id

	const initializedDocIdRef = useRef<string | undefined>(undefined)
	const lastDraftUpdatedAtRef = useRef<number | undefined>(undefined)
	const pendingContentRef = useRef<Record<string, unknown> | undefined>(
		undefined,
	)
	const isDiscardingRef = useRef(false)
	const titleInputRef = useRef(titleInput)
	titleInputRef.current = titleInput

	const { schedule: scheduleAutosave, cancel: cancelAutosave } =
		useDocAutosave(autosaveEnabled)
	const { patchMut, commitMut, discardMut } = useDocDraftMutations()

	// Cancel any pending autosave timer when the document identity changes or
	// the hook unmounts.
	useEffect(() => {
		return () => {
			cancelAutosave()
		}
	}, [id, cancelAutosave])

	const manualSaveAsync = useCallback(async (): Promise<void> => {
		const targetId = currentDocIdRef.current
		const titleAtSaveStart = titleInputRef.current
		const trimmedTitle = titleAtSaveStart.trim()
		const titleChanged =
			draft !== undefined &&
			trimmedTitle.length > 0 &&
			trimmedTitle !== draft.title
		const contentAtSaveStart = pendingContentRef.current
		if (!titleChanged && contentAtSaveStart === undefined) return
		if (
			contentAtSaveStart !== undefined &&
			charCount > MAX_DOC_CONTENT_TEXT_LENGTH
		) {
			toast.add({ title: t("documents.toast.contentTooLarge"), type: "error" })
			throw new Error("content too large")
		}
		const newDraft = await patchMut.mutateAsync({
			id: targetId,
			title: titleChanged ? trimmedTitle : undefined,
			content: contentAtSaveStart,
		})
		// Treat the just-saved draft as the current baseline so the upcoming
		// invalidation/refetch does not clobber keystrokes typed after the save.
		initializedDocIdRef.current = targetId
		lastDraftUpdatedAtRef.current = newDraft.updatedAt
		// Settle the pending buffers before the refetch round-trip: clearing
		// the dirty flag right after the patch resolves (instead of after the
		// refetch) keeps the save button from flashing enabled→disabled again
		// during the invalidation window.
		if (currentDocIdRef.current === targetId) {
			// Only clear the pending buffers if the user has not typed more while
			// the save was in flight. Otherwise the new keystrokes must survive.
			if (pendingContentRef.current === contentAtSaveStart) {
				pendingContentRef.current = undefined
				setContentDirty(false)
			}
			if (titleInputRef.current === titleAtSaveStart && titleChanged) {
				setTitleInputRaw(trimmedTitle)
			}
		}
		await invalidateDocuments(qc, targetId)
	}, [draft, charCount, patchMut, qc, t])

	const manualSave = useCallback(
		function manualSave() {
			manualSaveAsync().catch(() => {})
		},
		[manualSaveAsync],
	)

	const flushPendingContent = useCallback(
		function flushPendingContent() {
			manualSaveAsync().catch(() => {})
		},
		[manualSaveAsync],
	)

	const flushPendingContentRef = useRef(flushPendingContent)
	flushPendingContentRef.current = flushPendingContent

	const setTitleInput = useCallback(
		function setTitleInput(next: string) {
			setTitleInputRaw(next)
			// Mirror the raw input synchronously (not on render) so the
			// post-save normalization can distinguish "typed during the save"
			// even while React batches the render.
			titleInputRef.current = next
			if (!autosaveEnabled) return

			const trimmed = next.trim()
			const titleWillBeDirty =
				draft !== undefined && trimmed.length > 0 && trimmed !== draft.title
			if (!titleWillBeDirty) return

			scheduleAutosave(() => flushPendingContentRef.current())
		},
		[autosaveEnabled, draft, scheduleAutosave],
	)

	const onContentChange = useCallback(
		function onContentChange(content: Record<string, unknown>) {
			// During discard we imperatively replace the editor content with the
			// latest committed version. Ignore the transient onChange so the dirty
			// flag and pending buffer stay cleared.
			if (isDiscardingRef.current) return
			// Ignore repeated emissions of the exact same object reference.
			if (content === pendingContentRef.current) return
			// BlockNote can fire onChange without any actual content delta
			// (e.g. the AI extension touches the document while opening or
			// dismissing its menu). Compare against the saved baseline so the
			// dirty flag and autosave only fire on real edits.
			if (draft !== undefined && contentEquals(content, draft.content)) {
				pendingContentRef.current = undefined
				setContentDirty(false)
				cancelAutosave()
				return
			}
			pendingContentRef.current = content
			setContentDirty(true)
			scheduleAutosave(() => flushPendingContentRef.current())
		},
		[draft, cancelAutosave, scheduleAutosave],
	)

	const titleDirty = useMemo(() => {
		const trimmed = titleInput.trim()
		return draft !== undefined && trimmed.length > 0 && trimmed !== draft.title
	}, [draft, titleInput])

	const discardUnsaved = useCallback(
		function discardUnsaved() {
			if (draft === undefined) return
			isDiscardingRef.current = true
			try {
				editorHandleRef.current?.replaceContent(draft.content)
			} finally {
				isDiscardingRef.current = false
			}
			setTitleInputRaw(draft.title)
			pendingContentRef.current = undefined
			setContentDirty(false)
			cancelAutosave()
		},
		[draft, editorHandleRef, cancelAutosave],
	)

	const dirty = contentDirty || titleDirty
	const hasCommittableChange = computeHasCommittableChange({
		dirty,
		draft,
		latestVersionAt,
	})

	const requestCommit = useCallback(
		function requestCommit(openDialog: () => void) {
			if (!hasCommittableChange) return
			// Persist any unsaved buffer (including title) first so the version
			// captures the editor's current state, not the last autosaved state.
			manualSave()
			openDialog()
		},
		[hasCommittableChange, manualSave],
	)

	const submitCommit = useCallback(
		function submitCommit(message: string, onSuccess: () => void) {
			const targetId = currentDocIdRef.current
			commitMut.mutate(
				{ id: targetId, message: message.trim() || undefined },
				{
					onSuccess: async () => {
						await invalidateDocuments(qc, targetId)
						toast.add({
							title: t("documents.toast.committed"),
							type: "success",
						})
						onSuccess()
					},
				},
			)
		},
		[commitMut, qc, t],
	)

	const confirmDiscard = useCallback(
		function confirmDiscard(onSuccess: () => void) {
			const targetId = currentDocIdRef.current
			discardMut.mutate(targetId, {
				onSuccess: async (newDraft) => {
					await invalidateDocuments(qc, targetId)
					// Only wipe the current buffer if we are still on the discarded doc.
					if (currentDocIdRef.current !== targetId) return

					// Reset the UI to the freshly discarded (HEAD-based) draft
					// immediately. DocEditor only computes its initial blocks at mount,
					// so we must imperatively replace the document body; otherwise the
					// editor would keep showing the discarded draft until remount.
					isDiscardingRef.current = true
					try {
						editorHandleRef.current?.replaceContent(newDraft.content)
					} finally {
						isDiscardingRef.current = false
					}
					setTitleInputRaw(newDraft.title)
					pendingContentRef.current = undefined
					setContentDirty(false)
					initializedDocIdRef.current = undefined
					lastDraftUpdatedAtRef.current = undefined
					onSuccess()
				},
			})
		},
		[discardMut, qc, editorHandleRef],
	)

	useEffect(
		// Initialize the title input from the draft once per document id /
		// draft version. Re-evaluate when the draft is refetched so a
		// successful save/commit/discard resets the baseline cleanly.
		function syncTitleWithDraft() {
			// When the document id changes, reset the draft-tracking ref so
			// the next run is treated as a fresh initialization.
			if (initializedDocIdRef.current !== id) {
				lastDraftUpdatedAtRef.current = undefined
			}

			// Skip only when we have already initialised this exact document
			// with this exact draft timestamp.
			if (
				draft !== undefined &&
				initializedDocIdRef.current === id &&
				lastDraftUpdatedAtRef.current === draft.updatedAt
			) {
				return
			}

			initializedDocIdRef.current = id
			lastDraftUpdatedAtRef.current = draft?.updatedAt
			setTitleInputRaw(draft?.title ?? "")
			pendingContentRef.current = undefined
			setContentDirty(false)
			if (draft === undefined) {
				setCharCount(0)
			}
		},
		[id, draft],
	)

	const setHistoryFlags = useCallback(function setHistoryFlags(flags: {
		canUndo: boolean
		canRedo: boolean
	}) {
		setCanUndo(flags.canUndo)
		setCanRedo(flags.canRedo)
	}, [])

	const onCharCountChange = useCallback(function onCharCountChange(
		count: number,
	) {
		setCharCount(count)
	}, [])

	const charCountOverLimit = charCount > MAX_DOC_CONTENT_TEXT_LENGTH

	return {
		titleInput,
		setTitleInput,
		dirty,
		hasCommittableChange,
		canUndo,
		canRedo,
		charCount,
		charCountOverLimit,
		onCharCountChange,
		setHistoryFlags,
		onContentChange,
		flushPendingContent,
		manualSave,
		manualSaveAsync,
		discardUnsaved,
		requestCommit,
		submitCommit,
		confirmDiscard,
		patchPending: patchMut.isPending,
		commitPending: commitMut.isPending,
		discardPending: discardMut.isPending,
	}
}

/**
 * "Has changes since the last committed version", used to gate the commit
 * dialog. A change is recognised when:
 *   1. The editor has an unsaved buffer (`dirty`); or
 *   2. There is a draft and no version yet (first commit); or
 *   3. The draft has been saved more recently than the latest version.
 */
export function computeHasCommittableChange(
	args: Readonly<{
		dirty: boolean
		draft: Readonly<{ updatedAt: number }> | undefined
		latestVersionAt: number | undefined
	}>,
): boolean {
	const { dirty, draft, latestVersionAt } = args
	if (dirty) return true
	if (draft === undefined) return false
	if (latestVersionAt === undefined) return true
	return draft.updatedAt > latestVersionAt
}

/**
 * Cheap structural equality for BlockNote `{version, blocks}` payloads.
 * Used to suppress phantom dirty signals when the editor emits an
 * onChange without an actual document delta (e.g. selection-only mark
 * shuffles around the AI menu).
 */
export function contentEquals(
	next: Record<string, unknown>,
	prev: Record<string, unknown> | undefined,
): boolean {
	if (prev === undefined) return false
	if (next === prev) return true
	return isEqual(next, prev)
}
