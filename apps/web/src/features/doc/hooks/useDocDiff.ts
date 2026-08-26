import type { DocVersionMeta } from "@hoardodile/schemas"
import { toast } from "@hoardodile/ui/components/toast"
import { useQuery } from "@tanstack/react-query"
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { blocksOf } from "../contentShape.ts"
import { type DiffableBlock, loadDiffModule } from "../diff.ts"
import type { DocEditorHandle } from "../editor/DocEditor"
import { docVersionQueryOptions } from "../index.ts"

export type UseDocDiffInput = {
	readonly id: string
	readonly versions: readonly DocVersionMeta[]
	readonly isTrashed: boolean
	/** Handle of the main (editable) editor; its content is diffed against. */
	readonly editorHandleRef: RefObject<DocEditorHandle | null>
	/** Flushes unsaved buffers before entering diff so it matches what the user sees. */
	readonly manualSaveAsync: () => Promise<void>
}

export type UseDocDiffResult = {
	readonly diffMode: boolean
	readonly enteringDiff: boolean
	readonly canEnterDiff: boolean
	readonly diffVersionId: string | undefined
	readonly setDiffVersionId: (id: string) => void
	readonly enterDiff: () => Promise<void>
	readonly exitDiff: () => void
	/** Handle of the read-only twin editor that renders the diff document. */
	readonly diffEditorHandleRef: RefObject<DocEditorHandle | null>
	readonly onDiffEditorReady: () => (() => void) | undefined
	/** Stored content of the selected version, fed to the diff editor. */
	readonly diffEditorValue: Record<string, unknown> | undefined
}

/**
 * Diff-mode state machine for a document detail route: entering a diff
 * flushes the draft, snapshots the editor, and loads the selected version
 * into a read-only twin editor marked with insertion/deletion spans.
 * Diffing large documents is deferred so the UI stays responsive while
 * the diff editor mounts.
 */
export function useDocDiff(args: UseDocDiffInput): UseDocDiffResult {
	const { id, versions, isTrashed, editorHandleRef, manualSaveAsync } = args
	const { t } = useTranslation()
	const diffEditorHandleRef = useRef<DocEditorHandle | null>(null)
	const appliedDiffMarkerRef = useRef<string | undefined>(undefined)
	const [diffMode, setDiffMode] = useState(false)
	const [diffVersionId, setDiffVersionId] = useState<string | undefined>(
		undefined,
	)
	const [diffCurrentBlocks, setDiffCurrentBlocks] = useState<
		DiffableBlock[] | undefined
	>(undefined)
	const [diffEditorReady, setDiffEditorReady] = useState(false)
	const [enteringDiff, setEnteringDiff] = useState(false)

	const selectedVersionQuery = useQuery({
		...docVersionQueryOptions(id, diffVersionId ?? ""),
		enabled: diffMode && diffVersionId !== undefined,
	})

	// Leaving diff mode whenever the document identity changes prevents
	// showing another document's diff on top of the current editor.
	useEffect(() => {
		setDiffMode(false)
		setDiffVersionId(undefined)
		setDiffCurrentBlocks(undefined)
		setDiffEditorReady(false)
		appliedDiffMarkerRef.current = undefined
	}, [id])

	const enterDiff = useCallback(
		async function enterDiff(): Promise<void> {
			if (versions.length === 0) return
			const editor = editorHandleRef.current?.editor
			if (editor === undefined) return
			setEnteringDiff(true)
			try {
				// Flush any buffered edits and wait for the save to settle so the
				// diff matches what the user sees, and so the main editor remounts
				// with fresh content when the diff is closed.
				await manualSaveAsync()
			} catch {
				// The mutation layer already toasts the failure; stay out of diff.
				return
			} finally {
				setEnteringDiff(false)
			}
			setDiffCurrentBlocks(editor.document as DiffableBlock[])
			setDiffVersionId(versions[0]?.id)
			setDiffMode(true)
		},
		[versions, editorHandleRef, manualSaveAsync],
	)

	const exitDiff = useCallback(function exitDiff() {
		setDiffMode(false)
		setDiffVersionId(undefined)
		setDiffCurrentBlocks(undefined)
		setDiffEditorReady(false)
		appliedDiffMarkerRef.current = undefined
	}, [])

	// A version that fails to load must not leave a silently blank diff —
	// surface the failure and drop out of diff mode.
	useEffect(() => {
		if (!diffMode) return
		if (!selectedVersionQuery.isError) return
		toast.add({
			title: t("documents.toast.versionLoadFailed"),
			type: "error",
		})
		exitDiff()
	}, [diffMode, selectedVersionQuery.isError, exitDiff, t])

	const onDiffEditorReady = useCallback(function onDiffEditorReady():
		| (() => void)
		| undefined {
		setDiffEditorReady(true)
		return undefined
	}, [])

	const diffBaseBlocks = useMemo(
		() =>
			blocksOf(selectedVersionQuery.data?.content) as
				| DiffableBlock[]
				| undefined,
		[selectedVersionQuery.data?.content],
	)

	useEffect(() => {
		if (
			!diffMode ||
			!diffEditorReady ||
			diffCurrentBlocks === undefined ||
			diffVersionId === undefined
		)
			return
		const editor = diffEditorHandleRef.current?.editor
		if (editor === undefined) return
		const baseBlocks = diffBaseBlocks
		if (baseBlocks === undefined) return
		const marker = diffVersionId
		if (appliedDiffMarkerRef.current === marker) return
		// Diffing large documents is expensive; defer it so the UI stays
		// responsive while the diff editor mounts. The heavy diff machinery
		// (blocknote core, prosemirror changeset) lives in its own chunk —
		// it is only fetched once a diff actually opens.
		const timer = setTimeout(() => {
			void loadDiffModule()
				.then(async ({ blocksToDoc, computeInlineDiffDoc, applyDiffDoc }) => {
					if (appliedDiffMarkerRef.current === marker) return
					const schema = editor._tiptapEditor.state.schema
					const diff =
						computeInlineDiffDoc(editor, baseBlocks, diffCurrentBlocks) ??
						blocksToDoc(schema, diffCurrentBlocks)
					applyDiffDoc(editor, diff)
					appliedDiffMarkerRef.current = marker
				})
				.catch((err: unknown) => {
					if (appliedDiffMarkerRef.current === marker) return
					// A failed diff must never leave a silently blank
					// compare view: surface the failure (with its cause)
					// and drop out so the user is back on their document.
					console.error("[doc-diff] document diff computation failed", err)
					toast.add({
						title: t("documents.toast.diffFailed"),
						description:
							err instanceof Error ? err.message.slice(0, 200) : String(err),
						type: "error",
					})
					exitDiff()
				})
		}, 0)
		return () => clearTimeout(timer)
	}, [
		diffMode,
		diffCurrentBlocks,
		diffVersionId,
		diffEditorReady,
		diffBaseBlocks,
		exitDiff,
		t,
	])

	return {
		diffMode,
		enteringDiff,
		canEnterDiff:
			versions.length > 0 && !diffMode && !isTrashed && !enteringDiff,
		diffVersionId,
		setDiffVersionId,
		enterDiff,
		exitDiff,
		diffEditorHandleRef,
		onDiffEditorReady,
		diffEditorValue: selectedVersionQuery.data?.content as
			| Record<string, unknown>
			| undefined,
	}
}
