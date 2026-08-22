import {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { isBelowMd } from "@hoardodile/ui/hooks/use-mobile"
import { Cross } from "@hoardodile/ui/icons/marks"
import { Maximize, Minimize } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import type { RefObject } from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	type PreviewTarget,
	type PreviewWindowFlip,
	type PreviewWindowNeighbor,
	usePluginIframeSlot,
} from "@/features/plugin/iframe/use-iframe-slot"
import {
	resolvePreviewSizing,
	usePluginManifestUi,
	usePluginName,
} from "@/features/plugin/preview-sizing"
import { useUsageTracker } from "@/features/usage/useUsageTracker"

// ── Fullscreen interface ──────────────────────────────────────────────────────

export type FullscreenAPI = {
	readonly isFullscreen: boolean
	readonly toggle: () => void
}

/**
 * Drive the browser Fullscreen API against an externally-owned
 * container ref. The caller decides which element fullscreens (so
 * the same hook works for the dialog's content surface, the resource
 * detail page's preview block, etc.) and renders its own button.
 */
export function useContainerFullscreen(
	containerRef: RefObject<HTMLElement | null>,
): FullscreenAPI {
	const [isFullscreen, setIsFullscreen] = useState(false)
	useEffect(() => {
		function handleChange() {
			const el = containerRef.current
			const isFs = document.fullscreenElement === el
			setIsFullscreen(isFs)
			if (!isFs && el !== null) {
				el.classList.remove("mobile-fs-zoom")
			}
		}
		document.addEventListener("fullscreenchange", handleChange)
		return () => {
			document.removeEventListener("fullscreenchange", handleChange)
		}
	}, [containerRef])
	function toggle() {
		const el = containerRef.current
		if (el === null) return
		if (document.fullscreenElement === el) {
			void document.exitFullscreen()
		} else {
			if (isBelowMd()) {
				el.classList.add("mobile-fs-zoom")
			}
			void el.requestFullscreen()
		}
	}
	return { isFullscreen, toggle }
}

export type FullscreenButtonProps = {
	readonly api: FullscreenAPI
	readonly className?: string
}

/**
 * Tiny presentational fullscreen toggle. Stays decoupled from
 * {@link PreviewContent} so the surrounding chrome (dialog header,
 * detail page toolbar, feed overlay, …) decides when and where to
 * surface it.
 */
export function FullscreenButton(props: FullscreenButtonProps) {
	const { t } = useTranslation()
	const { isFullscreen, toggle } = props.api
	return (
		<button
			type="button"
			onClick={toggle}
			aria-label={t(
				isFullscreen
					? "resources.preview.exitFullscreen"
					: "resources.preview.enterFullscreen",
			)}
			className={
				props.className ??
				"flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-70 transition-opacity hover:opacity-100"
			}
			data-testid="preview-fullscreen-toggle"
		>
			{isFullscreen ? (
				<Minimize className="h-4 w-4" />
			) : (
				<Maximize className="h-4 w-4" />
			)}
		</button>
	)
}

// ── Content switcher ──────────────────────────────────────────────────────────

export type PreviewContentProps = PreviewTarget & {
	/**
	 * Server-resolved plugin id for the preview iframe:
	 * `contentPluginId` when that plugin is still registered and enabled,
	 * otherwise the builtin fallback plugin id. Absent when the caller has
	 * no card-level resolution (falls back to `contentPluginId`).
	 */
	readonly previewPluginId?: string
	/**
	 * Caller-supplied ref kept in sync with the live pool iframe. Combine
	 * with {@link useContainerFullscreen} to fullscreen the actual iframe
	 * element rather than the placeholder wrapper (which sits in a
	 * different DOM subtree than the floated iframe).
	 */
	readonly iframeRef?: RefObject<HTMLIFrameElement | null>
	/**
	 * Forces the iframe theme regardless of the host global theme. The
	 * dialog chrome is always dark, so callers should pass "dark".
	 */
	readonly forceTheme?: "light" | "dark"
	/**
	 * When true, appends the iframe directly into the placeholder instead
	 * of floating it via fixed positioning.
	 */
	readonly inline?: boolean
	/**
	 * The ±1 neighbors of the previewed resource (search dialog
	 * prev/next). Each gets a resident, pre-painted iframe inside the
	 * preview window so switching to one is a same-frame style flip.
	 * Consumers without a list (ResCard, trash, detail page) pass
	 * nothing — a 1-item window, same behavior as a single slot.
	 */
	readonly neighbors?: readonly PreviewWindowNeighbor[]
	/**
	 * Caller-owned mirror of the preview window's synchronous flip
	 * handle; the search dialog calls it in prev/next click handlers so
	 * content and chrome update in the same frame.
	 */
	readonly windowRef?: RefObject<PreviewWindowFlip | null>
	/** Called when the plugin placeholder enters or leaves the viewport. */
	readonly onContentVisibleChange?: (visible: boolean) => void
}

/**
 * Self-contained preview surface used both inside the lightbox dialog
 * and on the standalone resource detail page. All rendering happens in
 * the sandboxed plugin iframe that `usePluginIframeSlot` claims for
 * `contentPluginId` and feeds with a context push — this component only
 * provides the placeholder and surfaces loading/error state.
 *
 * Fullscreening is intentionally not implemented here: callers attach
 * their own {@link iframeRef} and render an external button via
 * {@link useContainerFullscreen} / {@link FullscreenButton} so the
 * dialog header, detail page toolbar, and feed overlay each control
 * the affordance themselves.
 */
export function PreviewContent(props: PreviewContentProps) {
	const { resId, resName, contentPluginId, sourceMeta, searchMeta, fileStats } =
		props
	const { t } = useTranslation()
	const [error, setError] = useState<string | null>(null)
	// The iframe claims the server-resolved effective plugin; the context
	// keeps the stored id untouched so the iframe can tell a fallback
	// preview from a normal one.
	const pluginId = props.previewPluginId ?? contentPluginId
	const fallbackPluginId =
		contentPluginId !== "" && pluginId !== contentPluginId
			? contentPluginId
			: undefined
	const fallbackPluginName = usePluginName(fallbackPluginId)
	const { ref, status, contentVisible, presented } = usePluginIframeSlot({
		pluginId,
		resId,
		resName,
		sourceMeta,
		searchMeta,
		fileStats,
		contentPluginId,
		zHint: 1001,
		forceTheme: props.forceTheme,
		iframeRef: props.iframeRef,
		inline: props.inline,
		neighbors: props.neighbors,
		windowRef: props.windowRef,
		onError: (info) => {
			console.error(
				`[plugin-error] ${info.pluginId} / ${info.resId}:`,
				info.error,
			)
			setError(info.error.message)
		},
	})

	useEffect(() => {
		props.onContentVisibleChange?.(contentVisible)
	}, [contentVisible, props.onContentVisibleChange])

	// Delay the loading indicator: switching to an idle pooled plugin only
	// needs one local bootstrap round-trip plus a couple of frames, so the
	// "loading" copy would flash for a fraction of a second on every
	// switch. Only surface it when the load is genuinely slow — and never
	// while a previous slot is still presented: on a cross-plugin switch
	// the held outgoing iframe stays on screen until its replacement is
	// ready, so there is content to look at and the copy would only
	// distract. The error display above is unaffected: a timeout error
	// must surface even while the held slot covers the switch.
	const [showLoading, setShowLoading] = useState(false)
	useEffect(() => {
		if (status !== "loading") {
			setShowLoading(false)
			return
		}
		const timer = setTimeout(() => setShowLoading(true), 150)
		return () => clearTimeout(timer)
	}, [status])

	return (
		<div
			ref={ref}
			className="relative flex h-full w-full items-center justify-center"
		>
			{fallbackPluginId !== undefined ? (
				<div className="absolute top-2 left-2 z-10 flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
					<span>
						{t("plugin.previewFallback", {
							name: fallbackPluginName ?? t("plugin.previewFallbackUnknown"),
						})}
					</span>
					<Link
						to="/settings/plugins"
						className="rounded bg-white/15 px-1.5 py-0.5 text-white/90 transition-colors hover:bg-white/25 hover:text-white"
						data-testid="preview-fallback-manage-link"
					>
						{t("plugin.previewFallbackManage")}
					</Link>
				</div>
			) : null}
			{status === "error" ? (
				<div className="text-sm text-red-400">
					{t("plugin.previewFailed")}: {error ?? t("common.unknownError")}
				</div>
			) : null}
			{showLoading && !presented ? (
				<div className="text-sm">{t("plugin.loading")}</div>
			) : null}
		</div>
	)
}

// ── Main component ────────────────────────────────────────────────────────────

export type ResPreviewDialogProps = PreviewTarget & {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	/**
	 * Server-resolved plugin id for the preview iframe (see
	 * {@link PreviewContentProps.previewPluginId}).
	 */
	readonly previewPluginId?: string
	/**
	 * Optional extra controls rendered under the preview surface.
	 * Used by `<ResSearch>` to inject prev/next navigation + paging.
	 */
	readonly bottomBar?: React.ReactNode
	/**
	 * Optional rail rendered to the left of the preview surface.
	 * Used by the trash preview to list entries for direct jumps.
	 */
	readonly sideBar?: React.ReactNode
	/** Prev/next neighbors for the preview window; see PreviewContent. */
	readonly neighbors?: readonly PreviewWindowNeighbor[]
	/** Synchronous flip handle mirror; see PreviewContent. */
	readonly windowRef?: RefObject<PreviewWindowFlip | null>
}

/**
 * Full-screen lightbox preview for a resource.
 *
 * Every media type is rendered by the content plugin's sandboxed iframe:
 * the dialog only renders a placeholder, and `usePluginIframeSlot` claims
 * a pooled iframe, pushes the plugin context (resId/resName, meta, theme,
 * prefs, file token) into it, and floats it over the placeholder. The
 * host never renders media directly — slideshows, readers,
 * and video playback all live inside the plugin.
 */
export function ResPreviewDialog(props: ResPreviewDialogProps) {
	const {
		resId,
		resName,
		contentPluginId,
		sourceMeta,
		searchMeta,
		fileStats,
		open,
		onOpenChange,
	} = props
	const { t } = useTranslation()
	const previewIframeRef = useRef<HTMLIFrameElement | null>(null)
	const fullscreenAPI = useContainerFullscreen(previewIframeRef)
	const [contentVisible, setContentVisible] = useState(false)
	useUsageTracker({
		entityType: "resource",
		entityId: resId,
		enabled: open,
		active: open && contentVisible,
	})
	// The plugin manifest may declare its preferred preview sizing
	// (`ui.aspect` capped by the viewport, or `ui.height`); the dialog
	// honors it the same way the resource detail page does. Resolve
	// against the effective plugin: a fallback to the builtin file plugin
	// declares no sizing, so the fallback height applies.
	const sizing = resolvePreviewSizing(
		usePluginManifestUi(props.previewPluginId ?? contentPluginId),
		{
			maxHeight: "85vh",
			fallbackHeight: "85vh",
		},
	)

	// `modal={false}` below opts out of react-remove-scroll, which registers
	// document-level *non-passive* wheel/touchmove listeners for the whole
	// time the dialog is open — those mark the same-origin plugin iframe's
	// region as a compositor-blocking zone and drop frames on page
	// turns / scroll. The trade-off is losing Radix's focus trap (and
	// background aria-hidden); acceptable here because the full-viewport
	// overlay already intercepts pointer input and outside interactions are
	// all preventDefault'ed below. Scroll locking is done manually by
	// pinning `document.body` overflow while open (with the cleanup below
	// also covering unmount; fullscreen toggling is unaffected since it
	// never touches body overflow).
	useEffect(() => {
		if (!open) return
		const previousOverflow = document.body.style.overflow
		const previousMarginRight = document.body.style.marginRight
		// Same gap compensation react-remove-scroll applies for the app's
		// modal dialogs: hide the body scrollbar and offset the freed width
		// with margin-right, so the page doesn't reflow on open/close.
		const scrollbarWidth =
			window.innerWidth - document.documentElement.clientWidth
		document.body.style.overflow = "hidden"
		if (scrollbarWidth > 0) {
			document.body.style.marginRight = `${scrollbarWidth}px`
		}
		return () => {
			document.body.style.overflow = previousOverflow
			document.body.style.marginRight = previousMarginRight
		}
	}, [open])

	return (
		<>
			{/* Own backdrop: kept instead of the dialog's Backdrop, which
			    Base UI renders even when `modal={false}` (Radix rendered
			    nothing in that case); the wrapper's Backdrop is hidden via
			    `overlayClassName` below. The plain fixed div also intercepts
			    all pointer input to the page behind, like the overlay did.
			    Deliberately NO backdrop blur: a full-viewport backdrop blur
			    is recomputed every frame and blocks hardware overlay
			    promotion for playing video. z-42 keeps it under the z-50
			    dialog content (the portal mounts later in the DOM anyway). */}
			{open ? (
				<div aria-hidden className="fixed inset-0 z-42 bg-black/85" />
			) : null}
			<Dialog
				open={open}
				onOpenChange={onOpenChange}
				modal={false}
				// Backdrop / outside taps must not dismiss: galleries and
				// readers contain large interactive surfaces (zoom,
				// scroll, video controls) that frequently bubble up
				// pointerdown to the overlay; closing only via the Cross button
				// avoids surprise dismissals mid-read.
				disablePointerDismissal
			>
				<DialogContent
					showCloseButton={false}
					overlayClassName="hidden"
					className={cn(
						"bg-transparent text-white ring-0 transition-none duration-0",
						"overflow-hidden rounded-none border-0 shadow-none sm:rounded-none",
						"data-open:animate-none data-closed:animate-none sm:data-open:animate-none sm:data-closed:animate-none",
						fullscreenAPI.isFullscreen
							? "inset-0 h-svh w-screen sm:inset-0 sm:max-w-none sm:max-h-none"
							: // Same width ceiling as the resource detail page's
								// max-w-480 content column.
								"left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-screen sm:w-[90vw] sm:max-w-480 sm:max-h-none",
					)}
					style={fullscreenAPI.isFullscreen ? undefined : sizing}
				>
					<DialogBody className="flex flex-col overflow-hidden p-0">
						<DialogTitle className="sr-only">
							{t("resources.preview.aria", { name: resName })}
						</DialogTitle>
						{/* ── Header ─────────────────────────────────────────── */}
						<div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 sm:px-1">
							<span className="max-w-[calc(100%-12rem)] truncate rounded bg-black/60 px-2 py-1 text-sm text-white">
								{resName}
							</span>
							<div className="flex items-center gap-2">
								<FullscreenButton api={fullscreenAPI} />
								<DialogClose
									render={
										<button
											type="button"
											aria-label={t("resources.preview.closePreview")}
											className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
										/>
									}
								>
									<Cross className="h-4 w-4" />
								</DialogClose>
							</div>
						</div>

						{/* ── Content ────────────────────────────────────────── */}
						<div className="flex min-h-0 flex-1 overflow-hidden">
							{props.sideBar !== undefined ? (
								<div className="shrink-0 overflow-y-auto">{props.sideBar}</div>
							) : null}
							<div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
								<div className="flex h-full w-full items-center justify-center overflow-hidden">
									<PreviewContent
										resId={resId}
										resName={resName}
										contentPluginId={contentPluginId}
										previewPluginId={props.previewPluginId}
										sourceMeta={sourceMeta}
										searchMeta={searchMeta}
										fileStats={fileStats}
										iframeRef={previewIframeRef}
										forceTheme="dark"
										neighbors={props.neighbors}
										windowRef={props.windowRef}
										onContentVisibleChange={setContentVisible}
									/>
								</div>
							</div>
						</div>
						{props.bottomBar !== undefined ? (
							<div className="shrink-0">{props.bottomBar}</div>
						) : null}
					</DialogBody>
				</DialogContent>
			</Dialog>
		</>
	)
}
