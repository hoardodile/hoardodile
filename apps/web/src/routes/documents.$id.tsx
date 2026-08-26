import {
	MAX_DOC_CONTENT_TEXT_LENGTH,
	MAX_NAME_LENGTH,
} from "@hoardodile/schemas"

import { Input } from "@hoardodile/ui/components/input"
import { MobileDrawer } from "@hoardodile/ui/components/mobile-drawer"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { toast } from "@hoardodile/ui/components/toast"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { CSSProperties } from "react"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { docDetailPageQueryOptions } from "@/features/doc"
import { DocDetailHeader } from "@/features/doc/components/DocDetailHeader"
import { DocDetailMeta } from "@/features/doc/components/DocDetailMeta"
import type { HeadingInfo } from "@/features/doc/components/DocHeadingNav"
import { DocNotFound } from "@/features/doc/components/DocNotFound"
import {
	DocSidePanel,
	DocSidePanelSlot,
} from "@/features/doc/components/DocSidePanel"
import { DocSpin } from "@/features/doc/components/DocSpin"
import {
	DocCommitDialog,
	DocDiscardDialog,
} from "@/features/doc/DocCommitDialogs"
import { useDocLayout } from "@/features/doc/DocLayoutContext"
import type { DocEditorHandle } from "@/features/doc/editor/DocEditor"
import { useDocCommitDialogs } from "@/features/doc/hooks/useDocCommitDialogs"
import { useDocDiff } from "@/features/doc/hooks/useDocDiff"
import { useDocDraft } from "@/features/doc/hooks/useDocDraft"
import { useDocFontSlot } from "@/features/doc/hooks/useDocFontSlot"
import { useDocLeaveGuard } from "@/features/doc/hooks/useDocLeaveGuard"
import {
	useDocReadingWidth,
	useDocumentPrefs,
} from "@/features/doc/hooks/useDocPrefs"
import { useDocScrollRestore } from "@/features/doc/hooks/useDocScrollRestore"
import { scrollBlockToReadingAnchorAfterLayout } from "@/features/doc/lib/docReadingAnchor"
import { useOnlineStatus } from "@/features/doc/offline/useOnlineStatus"
import { zoomLevelAt } from "@/features/doc/prefs"
import { usageEntityExposureQueryOptions } from "@/features/usage/api"
import { useUsageTracker } from "@/features/usage/useUsageTracker"
import { useDeferredMount } from "@/hooks/useDeferredMount"
import { useKeybinding } from "@/hooks/useKeybinding"
import { useStringPrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"

// The document editor is the one sanctioned lazy surface: blocknote,
// prosemirror, tiptap, yjs and the emoji dataset (~1.4 MB) load only when
// a document actually opens. The rest of the page (header, title, dialogs,
// drafts) stays in the main bundle; the editor position shows a skeleton
// while the chunk loads.
const DocEditorColumn = lazy(() =>
	import("@/features/doc/components/DocEditorColumn").then((m) => ({
		default: m.DocEditorColumn,
	})),
)

export const Route = createFileRoute("/documents/$id")({
	loader: async ({ context, params }) => {
		// A missing / hard-deleted document must not blow up the whole
		// page: swallow the rejection so the component renders the
		// friendly not-found state instead of the router's error boundary.
		await context.queryClient
			.ensureQueryData(docDetailPageQueryOptions(params.id))
			.catch(() => undefined)
	},
	component: DocDetailRoute,
})

function DocDetailRoute() {
	const { id } = Route.useParams()
	const qc = useQueryClient()
	const { t } = useTranslation()
	const layout = useDocLayout()
	const readingView = layout?.readingView ?? false
	const detailPageQuery = useQuery(docDetailPageQueryOptions(id))
	const exposureQuery = useQuery({
		...usageEntityExposureQueryOptions({
			entityType: "document",
			entityId: id,
		}),
		enabled: detailPageQuery.data?.nodeView?.node.kind === "document",
	})
	const view = detailPageQuery.data?.nodeView
	const node = view?.node
	const isTrashed = node?.deletedAt != null
	const draft = view?.draft
	const versions = view?.versions ?? []

	const editorHandleRef = useRef<DocEditorHandle | null>(null)
	const [headings, setHeadings] = useState<HeadingInfo[]>([])
	const [mobileNavOpen, setMobileNavOpen] = useState(false)

	// Mount the editor one frame after the route commits so the header and
	// title paint first; re-defer when switching to another document.
	const editorMounted = useDeferredMount(id)

	const draftStateRef = useRef<{ clearTransientDirty: () => void }>({
		clearTransientDirty() {},
	})

	const online = useOnlineStatus()

	const prefs = useDocumentPrefs({
		clearTransientDirty: () => draftStateRef.current.clearTransientDirty(),
	})
	const { readingWidth } = useDocReadingWidth()

	// Restore / capture the reading position once the editor is actually
	// mounted (deferred one frame).
	const editorReady = editorMounted
	useDocScrollRestore({
		docId: id,
		ready: editorReady,
		editorHandleRef,
	})

	const editorFont = useDocFontSlot(
		prefKeys.docEditorFont,
		prefKeys.docEditorFontInherit,
	)

	const [lastOpenedId, setLastOpenedId] = useStringPrefSync(
		prefKeys.docLastOpened,
		"",
	)

	const draftState = useDocDraft({
		id,
		draft,
		autosaveEnabled: prefs.autosaveEnabled && online,
		latestVersionAt: versions[0]?.createdAt,
		editorHandleRef,
		qc,
	})

	useDocLeaveGuard({
		dirty: draftState.dirty,
		message: t("documents.leaveDialog.confirm"),
	})

	// Expose the dirty-clear hook to prefs callbacks (forward declaration
	// because the prefs hook needs a callback that references draftState
	// which is created after it).
	draftStateRef.current.clearTransientDirty = () => {
		// `onContentChange` with the saved baseline collapses the dirty flag.
		if (draft !== undefined) draftState.onContentChange(draft.content)
	}

	const diff = useDocDiff({
		id,
		versions,
		isTrashed,
		editorHandleRef,
		manualSaveAsync: draftState.manualSaveAsync,
	})

	const dialogs = useDocCommitDialogs(draftState)

	const previewModeForUI = prefs.previewMode || isTrashed || diff.diffMode
	const inReadingView = readingView && !isTrashed && !diff.diffMode

	const handleNavigateToHeading = useCallback(function handleNavigateToHeading(
		blockId: string,
	) {
		const editor = editorHandleRef.current?.editor
		if (editor === undefined) return
		editor.setTextCursorPosition(blockId, "start")
		scrollBlockToReadingAnchorAfterLayout(blockId, editor.domElement, 0)
		setMobileNavOpen(false)
	}, [])

	const handleOpenHeadingNav = useCallback(function handleOpenHeadingNav() {
		setMobileNavOpen(true)
	}, [])

	const handleUndo = useCallback(function handleUndo() {
		editorHandleRef.current?.undo()
	}, [])

	const handleRedo = useCallback(function handleRedo() {
		editorHandleRef.current?.redo()
	}, [])

	const handleTogglePreviewMode = useCallback(
		function handleTogglePreviewMode() {
			prefs.togglePreviewMode(draftState.manualSave)
		},
		[prefs.togglePreviewMode, draftState.manualSave],
	)

	const handleToggleAutosave = useCallback(
		function handleToggleAutosave() {
			prefs.toggleAutosave(draftState.manualSave)
		},
		[prefs.toggleAutosave, draftState.manualSave],
	)

	const handleManualSave = useCallback(
		function handleManualSave() {
			// Saves are unconditional (last writer wins); an offline save
			// fails with the mutation's toast, nothing is staged locally.
			draftState.manualSave()
		},
		[draftState.manualSave],
	)

	const handleRequestCommit = useCallback(
		function handleRequestCommit() {
			dialogs.requestCommit()
		},
		[dialogs.requestCommit],
	)

	useKeybinding({ key: "s", ctrlOrMeta: true }, function handleForceSave() {
		if (previewModeForUI) return
		if (node?.kind !== "document" || draft === undefined) return
		draftState
			.manualSaveAsync()
			.then(() => {
				toast.add({ title: t("documents.toast.saved"), type: "success" })
			})
			.catch(() => {})
	})

	useKeybinding(
		{ key: "escape" },
		function handleExitReadingView() {
			layout?.toggleReadingView()
		},
		readingView,
	)

	useUsageTracker({
		entityType: "document",
		entityId: id,
		enabled:
			!detailPageQuery.isLoading &&
			!diff.diffMode &&
			node?.kind === "document" &&
			draft !== undefined,
	})

	useEffect(() => {
		if (
			!detailPageQuery.isLoading &&
			node?.kind === "document" &&
			draft !== undefined &&
			id !== lastOpenedId
		) {
			setLastOpenedId(id)
		}
	}, [
		id,
		node?.kind,
		draft,
		detailPageQuery.isLoading,
		lastOpenedId,
		setLastOpenedId,
	])

	// A stale "last opened" id (document hard-deleted, or the preference
	// survived a storage reset) must not keep routing the nav entry back
	// to a dead page: drop it, mirroring `useDocsHomeLastOpened` so the
	// next click lands on the documents home.
	useEffect(() => {
		if (detailPageQuery.isLoading) return
		if (node !== undefined) return
		if (lastOpenedId !== "") setLastOpenedId("")
	}, [detailPageQuery.isLoading, node, lastOpenedId, setLastOpenedId])

	if (detailPageQuery.isLoading) {
		return (
			<div className="flex h-full min-h-[50svh] flex-col items-center justify-center gap-4 text-muted-foreground">
				<DocSpin className="size-10 text-primary/70" strokeWidth={6} />
				<span className="doc-label">{t("common.loading")}</span>
			</div>
		)
	}
	if (node === undefined) {
		return <DocNotFound />
	}
	if (node.kind !== "document" || draft === undefined) {
		// Folder selected - render a lightweight placeholder so the
		// layout still feels responsive while the user navigates the tree.
		return (
			<div className="flex h-full min-h-[50svh] flex-col items-center justify-center p-8 text-center">
				<div className="flex flex-col gap-1.5">
					<p className="text-xl font-semibold tracking-wide">{node.title}</p>
					<p className="text-sm text-muted-foreground">
						{t("documents.folderHint")}
					</p>
				</div>
			</div>
		)
	}

	const zoom = zoomLevelAt(prefs.fontSizeIndex)

	// Mobile outline drawer: the heading-nav button — in the shell's top
	// bar below the sidebar breakpoint, in the doc header between it and
	// `panel:` — opens the side panel as a right drawer; at `panel:` the
	// column is a sibling of `<main>` and this stays closed.
	const tocDrawer = (
		<MobileDrawer
			open={mobileNavOpen}
			onOpenChange={setMobileNavOpen}
			side="right"
			width="w-panel"
			hideAbove="panel:hidden"
		>
			<DocSidePanel headings={headings} onNavigate={handleNavigateToHeading} />
		</MobileDrawer>
	)

	return (
		// The page scrolls in the shell's `<main>`; the outline portals
		// into the panel column beside it so the canvas scrollbar does
		// not sit past the sidebar, and the tab body scrolls on its own.
		// Immersive reading view is the same skeleton with the header
		// dropped, the title forced read-only, and a centered column.
		<div
			className="min-h-full min-w-0 w-full"
			data-doc-reading-view={inReadingView ? true : undefined}
			data-reading={inReadingView || previewModeForUI ? "true" : "false"}
			style={{ "--doc-reading-width": `${readingWidth}px` } as CSSProperties}
		>
			{!inReadingView && (
				<DocDetailHeader
					previewMode={previewModeForUI}
					previewModeLocked={isTrashed || diff.diffMode}
					diffMode={diff.diffMode}
					canEnterDiff={diff.canEnterDiff}
					autosaveEnabled={prefs.autosaveEnabled}
					indentEnabled={prefs.indentEnabled}
					fontSizeIndex={prefs.fontSizeIndex}
					zoom={zoom}
					canUndo={draftState.canUndo}
					canRedo={draftState.canRedo}
					dirty={draftState.dirty}
					hasCommittableChange={draftState.hasCommittableChange}
					hasVersions={versions.length > 0}
					versions={versions}
					diffVersionId={diff.diffVersionId}
					onChangeDiffVersionId={diff.setDiffVersionId}
					patchPending={draftState.patchPending}
					commitPending={draftState.commitPending}
					discardPending={draftState.discardPending}
					onUndo={handleUndo}
					onRedo={handleRedo}
					onTogglePreviewMode={handleTogglePreviewMode}
					onToggleAutosave={handleToggleAutosave}
					onToggleIndent={prefs.toggleIndent}
					onAdjustFontSize={prefs.adjustFontSize}
					onResetFontSize={prefs.resetFontSize}
					onManualSave={handleManualSave}
					onRequestCommit={handleRequestCommit}
					onOpenDiscard={dialogs.openDiscard}
					onEnterDiff={diff.enterDiff}
					onExitDiff={diff.exitDiff}
					onOpenHeadingNav={
						headings.length > 0 ? handleOpenHeadingNav : undefined
					}
				/>
			)}

			<div className="px-5 md:px-8">
				<div className="mx-auto w-full max-w-(--doc-reading-width,var(--container-reading)) flex flex-col gap-4 pt-8 pb-6">
					{previewModeForUI || inReadingView ? (
						<h1
							className={cn(
								"leading-[1.15] font-bold",
								inReadingView ? "text-5xl" : "text-4xl md:text-5xl",
							)}
							data-testid={
								inReadingView ? undefined : "document-title-readonly"
							}
						>
							{draftState.titleInput.length > 0
								? draftState.titleInput
								: t("documents.untitled")}
						</h1>
					) : (
						<Input
							value={draftState.titleInput}
							onChange={(e) => {
								draftState.setTitleInput(e.target.value)
							}}
							maxLength={MAX_NAME_LENGTH}
							placeholder={t("documents.untitled")}
							className="h-auto bg-transparent px-0 py-1 text-4xl leading-[1.15] font-bold focus-visible:ring-0 md:text-5xl dark:bg-transparent"
							data-testid="document-title"
						/>
					)}

					<DocDetailMeta
						charCount={draftState.charCount}
						createdAt={node.createdAt}
						updatedAt={node.updatedAt}
						exposure={exposureQuery.data}
					/>

					<Suspense
						fallback={
							// Same-height placeholder while the editor chunk
							// loads; the deferred-mount skeleton inside
							// DocEditorColumn takes over once it lands.
							<Skeleton className="min-h-[50svh] w-full" />
						}
					>
						<DocEditorColumn
							docId={id}
							zoom={zoom}
							indentEnabled={prefs.indentEnabled}
							editorFontFamily={editorFont.fontFamily}
							editorMounted={editorReady}
							readingView={inReadingView}
							diffMode={diff.diffMode}
							mainEditor={{
								value: draft?.content,
								editable: !prefs.previewMode && !isTrashed,
								placeholder: t("documents.placeholder"),
								onChange: (content) => {
									draftState.onContentChange(content)
								},
								onHistoryChange: draftState.setHistoryFlags,
								onHeadingsChange: setHeadings,
								onCharCountChange: draftState.onCharCountChange,
								handleRef: editorHandleRef,
							}}
							diffEditor={
								diff.diffMode
									? {
											value: diff.diffEditorValue,
											handleRef: diff.diffEditorHandleRef,
											onReady: diff.onDiffEditorReady,
										}
									: undefined
							}
							statusBar={
								!diff.diffMode && !inReadingView
									? {
											charCount: draftState.charCount,
											maxCharCount: MAX_DOC_CONTENT_TEXT_LENGTH,
											offline: !online,
										}
									: undefined
							}
						/>
					</Suspense>

					{!inReadingView && (
						<>
							<DocCommitDialog
								open={dialogs.commitOpen}
								onOpenChange={dialogs.setCommitOpen}
								message={dialogs.commitMessage}
								onMessageChange={dialogs.setCommitMessage}
								onSubmit={dialogs.submitCommit}
								isPending={draftState.commitPending}
								hasCommittableChange={draftState.hasCommittableChange}
							/>

							<DocDiscardDialog
								open={dialogs.discardOpen}
								onOpenChange={dialogs.setDiscardOpen}
								onConfirm={() => {
									dialogs.confirmDiscard()
								}}
								isPending={draftState.discardPending}
							/>
						</>
					)}
				</div>
			</div>
			<DocSidePanelSlot
				headings={headings}
				onNavigate={handleNavigateToHeading}
			/>
			{tocDrawer}
		</div>
	)
}
