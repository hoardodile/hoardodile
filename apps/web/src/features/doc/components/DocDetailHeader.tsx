import type { DocVersionMeta } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { useBelowSidebar } from "@hoardodile/ui/hooks/use-mobile"
import { More } from "@hoardodile/ui/icons/actions"
import { Cross } from "@hoardodile/ui/icons/marks"
import {
	AlignLeft,
	Bolt,
	BranchingPathsUp,
	ClockCircle,
	Compass,
	Eye,
	MagnifierZoomIn as MagniferZoomIn,
	MagnifierZoomOut as MagniferZoomOut,
	Pen,
	PenNewRound,
	SidebarMinimalistic,
	UndoLeft,
	UndoRight,
	UndoRightRound,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { memo } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import {
	useClaimTopbarSlot,
	useTopbarSlot,
} from "@/components/layout/topbarSlot"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import { useDateFormatter } from "@/features/settings/datePrefs.ts"
import { ZOOM_DEFAULT_INDEX, ZOOM_STEPS } from "../prefs.ts"

export type DocDetailHeaderProps = {
	readonly previewMode: boolean
	readonly previewModeLocked: boolean
	readonly diffMode: boolean
	readonly canEnterDiff: boolean
	readonly autosaveEnabled: boolean
	readonly indentEnabled: boolean
	readonly fontSizeIndex: number
	readonly zoom: number
	readonly canUndo: boolean
	readonly canRedo: boolean
	readonly dirty: boolean
	readonly hasCommittableChange: boolean
	readonly hasVersions: boolean
	readonly versions: readonly DocVersionMeta[]
	readonly diffVersionId: string | undefined
	readonly onChangeDiffVersionId: (id: string) => void
	readonly patchPending: boolean
	readonly commitPending: boolean
	readonly discardPending: boolean
	readonly onUndo: () => void
	readonly onRedo: () => void
	readonly onTogglePreviewMode: () => void
	readonly onToggleAutosave: () => void
	readonly onToggleIndent: () => void
	readonly onAdjustFontSize: (delta: number) => void
	readonly onResetFontSize: () => void
	readonly onManualSave: () => void
	readonly onRequestCommit: () => void
	readonly onOpenDiscard: () => void
	readonly onEnterDiff: () => void
	readonly onExitDiff: () => void
	/**
	 * Mobile-only: open the heading-outline drawer. Rendered as a List icon
	 * button in the shell's top-bar actions slot when provided.
	 */
	readonly onOpenHeadingNav?: () => void
}

/**
 * Sticky header for the document detail page. Composes undo/redo,
 * reading/diff mode toggles, the settings dropdown menu (zoom, autosave,
 * indent, diff, discard) and the primary save button.
 *
 * Below the sidebar breakpoint the bar is not rendered at all — the same
 * actions portal into the AppShell's mobile top row (`useTopbarSlot`), so
 * narrow viewports see a single top bar instead of stacked ones.
 *
 * All actions are passed in as callbacks so this component stays
 * presentation-only; the route owns the underlying state and
 * mutations.
 */
export const DocDetailHeader = memo(function DocDetailHeader(
	props: DocDetailHeaderProps,
) {
	const isMobile = useBelowSidebar()
	const topbarSlot = useTopbarSlot()
	// On desktop the shell's top row exists only while a route claims it
	// (its hamburger moved into the caption strip); below the sidebar
	// breakpoint this header is that route.
	useClaimTopbarSlot()

	if (isMobile) {
		if (topbarSlot === null) return null
		return createPortal(
			<div className="flex flex-1 items-center justify-between gap-1">
				{props.diffMode ? (
					<div className="ml-auto flex items-center gap-1">
						<DiffControls {...props} />
					</div>
				) : (
					<>
						<div className="flex items-center gap-1">
							{!props.previewMode && <UndoRedo {...props} />}
						</div>
						<div className="flex items-center gap-1">
							{props.onOpenHeadingNav !== undefined && (
								<HeadingNavButton onOpen={props.onOpenHeadingNav} />
							)}
							{!props.previewModeLocked && <PreviewToggle {...props} />}
							<MoreMenu {...props} />
							{!props.previewMode && <SavePrimary {...props} />}
						</div>
					</>
				)}
			</div>,
			topbarSlot,
		)
	}

	return (
		<header className="doc-detail-header sticky top-0 z-22 bg-background">
			{/* Centered content-measure cap like the Overview canvas
			    (max-w-content, --container-content): the measure is the
			    content width, so page padding lives on this outer wrapper;
			    px-8 matches the article column's padding, and py-4.5 puts
			    the buttons on the same optical line as the sidebar brand
			    row (34px). */}
			<div className="px-5 md:px-8">
				<div className="mx-auto flex w-full max-w-content min-w-0 items-center gap-2 py-4.5 desktop-shell:py-0.5">
					<div className="flex min-w-0 flex-1 items-center gap-2">
						{props.diffMode ? (
							<DiffControls {...props} />
						) : (
							!props.previewMode && <UndoRedo {...props} />
						)}
					</div>
					{/* More at the edge, then the outline drawer trigger, then the
					    labeled preview switch and the primary save — no icon
					    island between two buttons (DESIGN — DocumentPage top
					    bar). The trigger hides once the right side panel takes
					    over at ≥1440px; below the sidebar breakpoint the
					    header itself is not rendered and the trigger lives in
					    the shell's top bar. */}
					<div className="flex min-w-0 items-center gap-2">
						<MoreMenu {...props} />
						{props.onOpenHeadingNav !== undefined && (
							<HeadingNavButton
								onOpen={props.onOpenHeadingNav}
								className="min-[1440px]:hidden"
							/>
						)}
						{!props.previewModeLocked && <PreviewToggle {...props} labeled />}
						{!props.previewMode && <SavePrimary {...props} />}
					</div>
				</div>
			</div>
		</header>
	)
})

type SharedProps = DocDetailHeaderProps

function HeadingNavButton(props: {
	readonly onOpen: () => void
	readonly className?: string
}) {
	const { t } = useTranslation()
	return (
		<Button
			variant="ghost"
			size="icon"
			className={cn(
				"size-8 text-muted-foreground hover:text-foreground",
				props.className,
			)}
			onClick={props.onOpen}
			title={t("documents.headings")}
			aria-label={t("documents.headings")}
			data-testid="document-open-heading-nav"
		>
			<SidebarMinimalistic className="size-4" strokeWidth={1.6} />
		</Button>
	)
}

function UndoRedo(props: SharedProps) {
	const { t } = useTranslation()
	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				onClick={props.onUndo}
				disabled={!props.canUndo}
				className="size-8 text-muted-foreground hover:text-foreground"
				title={t("documents.toolbar.undo")}
				aria-label={t("documents.toolbar.undo")}
				data-testid="document-undo"
			>
				<UndoLeft className="size-4" strokeWidth={1.6} />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				onClick={props.onRedo}
				disabled={!props.canRedo}
				className="size-8 text-muted-foreground hover:text-foreground"
				title={t("documents.toolbar.redo")}
				aria-label={t("documents.toolbar.redo")}
				data-testid="document-redo"
			>
				<UndoRight className="size-4" strokeWidth={1.6} />
			</Button>
		</>
	)
}

function DiffControls(props: SharedProps) {
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	return (
		<>
			<Button
				variant="default"
				size="sm"
				onClick={props.onExitDiff}
				title={t("documents.diff.exit")}
				data-testid="document-exit-diff"
			>
				<Cross className="size-3.5" />
				<span className="ml-1 hidden lg:inline">
					{t("documents.diff.exit")}
				</span>
			</Button>
			<VersionSelector
				versions={props.versions}
				selectedId={props.diffVersionId}
				onSelect={props.onChangeDiffVersionId}
				themeClass={themeClass}
			/>
		</>
	)
}

function PreviewToggle(props: SharedProps & { readonly labeled?: boolean }) {
	const { t } = useTranslation()
	const icon = props.previewMode ? (
		<Pen className="size-4" strokeWidth={1.6} />
	) : (
		<Eye className="size-4" strokeWidth={1.6} />
	)
	const label = props.previewMode
		? t("documents.readOnly.disable")
		: t("documents.readOnly.enable")
	if (props.labeled === true) {
		// The desktop top bar shows the preview switch as a standard
		// secondary button (the muted-fill ghost) between the more
		// menu and the primary save; it latches to the accent fill
		// while preview is active. The mobile slot keeps the icon-only
		// toggle.
		return (
			<Button
				variant="secondary"
				active={props.previewMode}
				aria-pressed={props.previewMode}
				onClick={props.onTogglePreviewMode}
				title={label}
				aria-label={label}
				data-testid="document-reading-toggle"
			>
				{icon}
				{label}
			</Button>
		)
	}
	return (
		<Button
			variant="ghost"
			size="icon"
			className="size-8 text-muted-foreground hover:text-foreground"
			onClick={props.onTogglePreviewMode}
			title={label}
			aria-label={label}
			data-testid="document-reading-toggle"
		>
			{icon}
		</Button>
	)
}

function MoreMenu(props: SharedProps) {
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	const {
		previewMode,
		autosaveEnabled,
		indentEnabled,
		fontSizeIndex,
		zoom,
		dirty,
		hasCommittableChange,
		hasVersions,
		patchPending,
		commitPending,
		discardPending,
	} = props
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className="size-8 text-muted-foreground hover:text-foreground"
						title={t("documents.moreActions")}
						data-testid="document-more"
					>
						<More className="size-5" strokeWidth={1.6} />
					</Button>
				}
			/>
			<DropdownMenuContent align="end" className={cn("doc w-60", themeClass)}>
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
						<MagniferZoomIn className="size-3.5" />
						{t("documents.zoom.label")}
					</DropdownMenuLabel>
					<div className="flex items-center gap-1 px-2 pb-1.5">
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 px-2"
							onClick={() => props.onAdjustFontSize(-1)}
							disabled={fontSizeIndex === 0}
							title={t("documents.zoom.smaller")}
							data-testid="document-zoom-smaller"
						>
							<MagniferZoomOut className="size-3.5" />
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 px-2 text-xs tabular-nums"
							onClick={props.onResetFontSize}
							disabled={fontSizeIndex === ZOOM_DEFAULT_INDEX}
							title={t("documents.zoom.reset")}
							data-testid="document-zoom-reset"
						>
							{Math.round(zoom * 100)}%
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 px-2"
							onClick={() => props.onAdjustFontSize(1)}
							disabled={fontSizeIndex === ZOOM_STEPS.length - 1}
							title={t("documents.zoom.larger")}
							data-testid="document-zoom-larger"
						>
							<MagniferZoomIn className="size-3.5" />
						</Button>
					</div>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem
					checked={indentEnabled}
					onCheckedChange={props.onToggleIndent}
					data-testid="document-indent-toggle"
				>
					<AlignLeft className="mr-2 size-3.5" />
					{t("documents.indent.enable")}
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem
					checked={autosaveEnabled}
					onCheckedChange={props.onToggleAutosave}
					disabled={previewMode}
					data-testid="document-autosave-toggle"
				>
					<Bolt className="mr-2 size-3.5" />
					{t("documents.autosave.enable")}
				</DropdownMenuCheckboxItem>
				<DropdownMenuItem
					onClick={props.onEnterDiff}
					disabled={!props.canEnterDiff}
					data-testid="document-enter-diff"
				>
					<BranchingPathsUp className="mr-2 size-3.5" />
					{t("documents.diff.show")}
				</DropdownMenuItem>
				{!previewMode && (
					<DropdownMenuItem
						onClick={props.onManualSave}
						disabled={patchPending || !dirty}
						data-testid="document-save"
					>
						<PenNewRound className="mr-2 size-3.5" />
						{t("documents.saveDraft")}
					</DropdownMenuItem>
				)}
				{!previewMode && (
					<DropdownMenuItem
						onClick={props.onRequestCommit}
						disabled={commitPending || !hasCommittableChange}
						data-testid="document-commit"
					>
						<PenNewRound className="mr-2 size-3.5" />
						{t("documents.commit")}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					data-testid="document-back-home"
					render={
						<Link to="/documents" className="flex w-full items-center gap-2">
							<Compass className="mr-2 size-3.5" />
							{t("documents.backToStart")}
						</Link>
					}
				/>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={props.onOpenDiscard}
					disabled={previewMode || discardPending || !hasVersions}
					data-testid="document-discard"
					className="text-destructive focus:text-destructive"
				>
					<UndoRightRound className="mr-2 size-3.5" />
					{t("documents.discardDraft")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function SavePrimary(props: SharedProps) {
	const { t } = useTranslation()
	return (
		<Button
			variant="default"
			onClick={props.onManualSave}
			disabled={props.patchPending || !props.dirty}
			className={cn(!props.autosaveEnabled && props.dirty && "relative")}
			data-testid="document-save-primary"
		>
			{t("documents.saveDraft")}
			{!props.autosaveEnabled && props.dirty && (
				<span
					className={cn(
						"absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary",
						props.patchPending && "animate-pulse",
					)}
					data-testid="document-save-dot"
				/>
			)}
		</Button>
	)
}

const VersionSelector = memo(function VersionSelector(props: {
	readonly versions: readonly DocVersionMeta[]
	readonly selectedId: string | undefined
	readonly onSelect: (id: string) => void
	readonly themeClass: string | undefined
}) {
	const { t } = useTranslation()
	const formatter = useDateFormatter()
	const selected = props.versions.find((v) => v.id === props.selectedId)
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="max-w-40 truncate md:max-w-56"
						title={t("documents.diff.compareWith")}
						data-testid="document-diff-version-selector"
					>
						<ClockCircle className="size-3.5 shrink-0" />
						<span className="ml-1 truncate">
							{selected !== undefined
								? `v${selected.versionNo} · ${selected.title}`
								: t("documents.diff.selectVersion")}
						</span>
					</Button>
				}
			/>
			<DropdownMenuContent
				align="start"
				className={cn("doc w-72", props.themeClass)}
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{t("documents.diff.compareWith")}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuRadioGroup
					value={props.selectedId}
					onValueChange={(value) => props.onSelect(value)}
				>
					{props.versions.map((version) => (
						<DropdownMenuRadioItem key={version.id} value={version.id}>
							<div className="flex flex-col">
								<span className="truncate text-sm">
									v{version.versionNo} · {version.title}
								</span>
								<span className="text-xs text-muted-foreground">
									{formatter.formatDateTime(version.createdAt)}
									{version.message.length > 0 ? ` · ${version.message}` : ""}
								</span>
							</div>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
})
