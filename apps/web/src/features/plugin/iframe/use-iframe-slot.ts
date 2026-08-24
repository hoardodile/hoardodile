import {
	type PluginIframeContext,
	pluginThemePalettes,
} from "@hoardodile/sdk-web"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import type { RefObject } from "react"
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import { fontArrayCodec } from "@/features/prefs"
import { resDetailCardQueryOptions } from "@/features/res/api"
import i18n from "@/i18n"
import { buildFontFamily, collectFontCssPaths } from "@/lib/fonts"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import {
	pluginListAllQueryOptions,
	previewInitContextQueryOptions,
} from "../pluginApi"
import { claim, type PoolClaimedEntry } from "./iframe-pool"
import {
	createPreviewWindow,
	type PreviewTarget,
	type PreviewWindow,
	type PreviewWindowItem,
	type PreviewWindowNeighbor,
} from "./preview-window"

export type {
	PreviewTarget,
	PreviewWindowFlip,
	PreviewWindowNeighbor,
} from "./preview-window"

// ── useIframeLifecycle ───────────────────────────────────────────────────────

export type SlotStatus = "loading" | "ready" | "error"

// Exported for unit tests; only consumed internally by usePluginIframeSlot.
export function useIframeLifecycle(opts: {
	readonly slot: PoolClaimedEntry | null
	readonly placeholder: HTMLElement | null
	readonly pluginId: string
	readonly resId: string
	readonly onError?: (info: {
		readonly pluginId: string
		readonly resId: string
		readonly error: Error
	}) => void
	readonly slotReady: boolean
}): { readonly status: SlotStatus; readonly contentVisible: boolean } {
	const { slot, placeholder, pluginId, resId, onError, slotReady } = opts
	const [status, setStatus] = useState<SlotStatus>("loading")
	const [contentVisible, setContentVisible] = useState(true)
	const loadedRef = useRef(false)
	const onErrorRef = useRef(onError)

	useEffect(() => {
		onErrorRef.current = onError
	}, [onError])

	useEffect(() => {
		if (slot === null || placeholder === null) return
		loadedRef.current = false
		setStatus("loading")

		let intersecting = true
		setContentVisible(true)
		// Visibility pushes for the focused slot funnel through here so the
		// slotReady gate lives in exactly one place: until the plugin has
		// painted the fresh context's first frame, a reused iframe may
		// still hold the previous resource's tree — telling it "visible"
		// now would briefly resume stale rendering/media. This effect
		// re-runs when slotReady flips and pushes the current IO state
		// then. (The preview window additionally pushes visibility on
		// every presentation flip — presented true, parked false — which
		// is where non-focused slots get theirs.)
		function pushVisibility(visible: boolean): void {
			if (slot !== null && slotReady) {
				slot.setVisibility(visible)
			}
		}
		const io = new IntersectionObserver(
			(entries) => {
				const isIntersecting = entries.some((e) => e.isIntersecting)
				if (isIntersecting === intersecting) return
				intersecting = isIntersecting
				setContentVisible(isIntersecting)
				pushVisibility(isIntersecting)
			},
			{ threshold: 0 },
		)
		io.observe(placeholder)
		pushVisibility(intersecting)

		const unsubLoad = slot.onLoaded(() => {
			loadedRef.current = true
			if (slotReady) {
				setStatus("ready")
			}
		})

		if (slotReady && loadedRef.current) {
			setStatus("ready")
		}

		const timeout = setTimeout(() => {
			if (!loadedRef.current) {
				setStatus("error")
				onErrorRef.current?.({
					pluginId,
					resId,
					error: new Error("Plugin preview timed out"),
				})
			}
		}, 30_000)

		return () => {
			clearTimeout(timeout)
			unsubLoad()
			io.disconnect()
		}
	}, [slot, placeholder, pluginId, resId, slotReady])

	return { status, contentVisible }
}

// ── useWindowGeometrySync ────────────────────────────────────────────────────

// Per-iframe cache of the last geometry values written, so unchanged
// values are never re-written (see syncGeometry below).
type WrittenGeometry = {
	display?: string
	top?: number
	left?: number
	width?: number
	height?: number
}

/**
 * Stacks every window slot's iframe over the placeholder. Geometry ONLY:
 * top/left/width/height, plus display (none while the placeholder has a
 * zero rect, block otherwise). opacity/pointerEvents/zIndex belong to the
 * preview window's presentation writer — the two never touch each
 * other's properties.
 */
// Exported for unit tests; only consumed internally by usePluginIframeSlot.
export function useWindowGeometrySync(opts: {
	readonly placeholder: HTMLElement | null
	readonly window: Pick<PreviewWindow, "getSnapshot" | "subscribe">
}): void {
	const { placeholder, window: previewWindow } = opts

	useLayoutEffect(() => {
		if (placeholder === null) return

		// Cache of the last values written to each iframe. The RO fires on
		// every observed box change, and even identical style writes on
		// width/height invalidate layout inside the plugin iframe — skip any
		// write whose value has not actually changed.
		const cache = new Map<HTMLIFrameElement, WrittenGeometry>()

		function syncGeometry() {
			if (placeholder === null) return

			const rect = placeholder.getBoundingClientRect()
			const zero = rect.width === 0 || rect.height === 0
			const live = new Set<HTMLIFrameElement>()
			for (const slot of previewWindow.getSnapshot().slots) {
				const iframe = slot.iframe
				live.add(iframe)
				let written = cache.get(iframe)
				if (written === undefined) {
					written = {}
					cache.set(iframe, written)
				}
				if (zero) {
					if (written.display !== "none") {
						iframe.style.display = "none"
						written.display = "none"
					}
					continue
				}
				if (written.display !== "block") {
					iframe.style.display = "block"
					written.display = "block"
				}

				// Round to whole CSS pixels: the centered dialog (transform +
				// 85vh/90vw sizing) produces fractional rects, and fractional
				// iframe sizes force the compositor to resample the layer every
				// frame and block video overlay promotion.
				const top = Math.round(rect.top)
				if (top !== written.top) {
					iframe.style.top = `${top}px`
					written.top = top
				}
				const left = Math.round(rect.left)
				if (left !== written.left) {
					iframe.style.left = `${left}px`
					written.left = left
				}
				const width = Math.round(rect.width)
				if (width !== written.width) {
					iframe.style.width = `${width}px`
					written.width = width
				}
				const height = Math.round(rect.height)
				if (height !== written.height) {
					iframe.style.height = `${height}px`
					written.height = height
				}
			}
			// Slots released since the last tick no longer need tracking.
			for (const iframe of [...cache.keys()]) {
				if (!live.has(iframe)) cache.delete(iframe)
			}
		}

		syncGeometry()

		const ro = new ResizeObserver(syncGeometry)
		ro.observe(placeholder)

		// The RO only fires on *size* changes; a window resize can move the
		// transform-centered placeholder without resizing it, which would
		// leave the floated iframes misaligned.
		window.addEventListener("resize", syncGeometry)

		// A newly claimed window slot must be stacked over the placeholder
		// immediately — the RO will not tick for it (nothing resized), and
		// an unpositioned iframe would stay display:none and never paint.
		const unsubscribe = previewWindow.subscribe(syncGeometry)

		return () => {
			ro.disconnect()
			window.removeEventListener("resize", syncGeometry)
			unsubscribe()
		}
	}, [placeholder, previewWindow])
}

// ── Context assembly ─────────────────────────────────────────────────────────

type ResolvedTheme = PluginIframeContext["resolvedTheme"]
type Palette = PluginIframeContext["palette"]
type IconStyle = PluginIframeContext["iconStyle"]

function readTheme(): ResolvedTheme {
	return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

// The host ThemeProvider only writes `theme-*` classes (never `data-theme`),
// so the palette must be read from the class list, same as readTheme.
function readPalette(): Palette {
	for (const palette of pluginThemePalettes) {
		if (palette === "mono") continue
		if (document.documentElement.classList.contains(`theme-${palette}`)) {
			return palette
		}
	}
	return "mono"
}

// The host IconStyleProvider mirrors the style as `data-icon-style`; stale
// or missing values fall back to the default look.
function readIconStyle(): IconStyle {
	const style = document.documentElement.dataset.iconStyle
	return style === "grayscale" || style === "linear" ? style : "duotone"
}

/** Empty font payload for plugins that opted out via `ui.inheritFont: false`. */
const NO_FONTS: PluginIframeContext["fonts"] = { family: "", cssPaths: [] }

/**
 * Reads the host's current app font preference as the family stack plus the
 * preset stylesheets backing it, so the sandboxed iframe can reproduce the
 * font inside its opaque-origin document.
 */
function readHostFonts(): PluginIframeContext["fonts"] {
	const keys = fontArrayCodec.decode(prefSync.get(prefKeys.appFont) ?? "") ?? []
	return {
		family: buildFontFamily(keys),
		cssPaths: collectFontCssPaths(keys),
	}
}

/**
 * The slice of the `plugin.previewInitContext` bootstrap payload the
 * iframe context consumes.
 */
export type PreviewInitResult = {
	readonly prefs: Record<string, string>
	readonly cache: Record<string, string>
	readonly fileToken: string
	/** Plugin-scoped asset-vault token (empty when the manifest lacks `download`). */
	readonly assetToken: string
}

/**
 * Pure assembly of the iframe context: reads language/theme/palette from
 * the host environment and merges the bootstrap payload (or its empty
 * fallbacks). Extracted from the context loaders so the effects only
 * fetch data and post the result.
 */
export function buildPluginIframeContext(
	opts: PreviewTarget & {
		readonly pluginId: string
		readonly forceTheme?: "light" | "dark"
		readonly inheritFont?: boolean
		readonly init?: PreviewInitResult
	},
): PluginIframeContext {
	const {
		pluginId,
		resId,
		resName,
		sourceMeta,
		searchMeta,
		fileStats,
		contentPluginId,
		forceTheme,
		inheritFont = true,
		init,
	} = opts
	return {
		pluginId,
		resId,
		resName,
		sourceMeta,
		searchMeta,
		fileStats,
		contentPluginId,
		language: i18n.resolvedLanguage || i18n.language || "en",
		resolvedTheme: forceTheme ?? readTheme(),
		palette: readPalette(),
		iconStyle: readIconStyle(),
		fonts: inheritFont ? readHostFonts() : NO_FONTS,
		initialPrefs: init?.prefs ?? {},
		initialCache: init?.cache ?? {},
		fileToken: init?.fileToken ?? "",
		assetToken: init?.assetToken ?? "",
	}
}

/**
 * Read the plugin's asset fingerprint imperatively: the plugin list
 * resolves asynchronously, and re-claiming when it lands would reload
 * the iframe a second time.
 */
function readAssetVersion(
	qc: QueryClient,
	pluginId: string,
): string | undefined {
	return qc
		.getQueryData(pluginListAllQueryOptions().queryKey)
		?.find((p) => p.id === pluginId)?.assetVersion
}

/**
 * Reads the plugin manifest's font-inheritance flag imperatively, from the
 * same plugin list query as {@link readAssetVersion}. Absent or true means
 * the iframe inherits the host app font.
 */
export function readInheritFont(qc: QueryClient, pluginId: string): boolean {
	return (
		qc
			.getQueryData(pluginListAllQueryOptions().queryKey)
			?.find((p) => p.id === pluginId)?.manifest.ui?.inheritFont !== false
	)
}

/**
 * The preview window's context loader for the focused item. The
 * aggregated bootstrap request fires the moment the slot is claimed so
 * it runs in parallel with the iframe load. Goes through the query
 * cache: the search dialog prefetches this exact query for neighboring
 * resources, so a left/right switch reuses the in-flight (or fresh)
 * result instead of paying the round-trip. Best-effort: on failure the
 * context falls back to empty prefs/cache/token and the iframe still
 * works.
 */
function loadFocusedContext(
	qc: QueryClient,
	item: PreviewWindowItem,
	forceThemeRef: RefObject<"light" | "dark" | undefined>,
): Promise<PluginIframeContext> {
	return qc
		.fetchQuery(
			previewInitContextQueryOptions({
				pluginId: item.pluginId,
				resId: item.resId,
			}),
		)
		.catch(() => undefined)
		.then((init) =>
			buildPluginIframeContext({
				...item,
				forceTheme: forceThemeRef.current,
				inheritFont: readInheritFont(qc, item.pluginId),
				init,
			}),
		)
}

/**
 * The preview window's context loader for a ±1 neighbor: builds the
 * full target fields from the detail card (usually a warm hit on the
 * search dialog's neighbor prefetch effect; fetchQuery dedupes
 * regardless) plus the same bootstrap payload the focused item gets.
 */
async function loadNeighborContext(
	qc: QueryClient,
	neighbor: PreviewWindowNeighbor,
): Promise<PluginIframeContext> {
	const [card, init] = await Promise.all([
		qc.fetchQuery(resDetailCardQueryOptions(neighbor.resId)),
		qc
			.fetchQuery(
				previewInitContextQueryOptions({
					pluginId: neighbor.pluginId,
					resId: neighbor.resId,
				}),
			)
			.catch(() => undefined),
	])
	return buildPluginIframeContext({
		pluginId: neighbor.pluginId,
		resId: neighbor.resId,
		resName: card.name,
		sourceMeta: card.sourceMeta,
		searchMeta: card.searchMeta,
		fileStats: card.fileStats,
		contentPluginId: card.contentPluginId ?? neighbor.pluginId,
		inheritFont: readInheritFont(qc, neighbor.pluginId),
		init,
	})
}

/**
 * Writes the inline iframe's user-facing presentation. While not ready
 * the iframe stays *painted but transparent* (opacity 0, no pointer
 * events) instead of display:none — the plugin keeps producing frames
 * underneath, so flipping opacity never replays the previous resource's
 * last compositor frame (which a display:none → block transition would
 * for a frame or two).
 */
function setFramePresentation(
	iframe: HTMLIFrameElement,
	presented: boolean,
): void {
	iframe.style.opacity = presented ? "1" : "0"
	iframe.style.pointerEvents = presented ? "auto" : "none"
}

// ── usePluginIframeSlot ──────────────────────────────────────────────────────

export type UsePluginIframeSlotOptions = PreviewTarget & {
	readonly pluginId: string
	readonly zHint?: number
	readonly onError?: (info: {
		readonly pluginId: string
		readonly resId: string
		readonly error: Error
	}) => void
	readonly iframeRef?: RefObject<HTMLIFrameElement | null>
	readonly forceTheme?: "light" | "dark"
	readonly inline?: boolean
	/**
	 * The ±1 neighbors of the focused resource (search dialog prev/next).
	 * Each gets its own resident, painted iframe inside the preview
	 * window, so switching to one is a same-frame style flip.
	 */
	readonly neighbors?: readonly PreviewWindowNeighbor[]
	/**
	 * Caller-owned mirror of the window's synchronous flip handle, so a
	 * click handler can present a ready neighbor in the same frame as the
	 * chrome update, before any React effect runs.
	 */
	readonly windowRef?: RefObject<{
		flipNow: (resId: string) => boolean
	} | null>
}

export type UsePluginIframeSlotResult = {
	readonly ref: (el: HTMLElement | null) => void
	readonly status: SlotStatus
	readonly contentVisible: boolean
	/**
	 * Whether a slot iframe is currently on screen — either the focused
	 * slot (ready) or the previously presented slot held during a switch.
	 * False only on a cold open, before the first slot has painted.
	 */
	readonly presented: boolean
}

export function usePluginIframeSlot(
	opts: UsePluginIframeSlotOptions,
): UsePluginIframeSlotResult {
	const {
		pluginId,
		resId,
		resName,
		sourceMeta,
		searchMeta,
		fileStats,
		contentPluginId,
		zHint = 0,
		onError,
		iframeRef,
		forceTheme,
		inline,
		neighbors,
		windowRef,
	} = opts
	const isInline = inline === true
	const [placeholder, setPlaceholder] = useState<HTMLElement | null>(null)
	const qc = useQueryClient()

	// The window's focused-context loader reads the theme override long
	// after creation; keep the latest value in a ref.
	const forceThemeRef = useRef(forceTheme)
	useEffect(() => {
		forceThemeRef.current = forceTheme
	}, [forceTheme])

	// The preview window owns the claim lifetimes of the focused resource
	// and its ±1 neighbors: claim, context push, paint-ack readiness, the
	// held-presentation fallback, and the same-frame flip. Lazily
	// initialized ref — the one ref write React Compiler allows during
	// render. Created even in inline mode, where it simply never receives
	// a focus() call.
	const windowInstanceRef = useRef<PreviewWindow | null>(null)
	if (windowInstanceRef.current === null) {
		windowInstanceRef.current = createPreviewWindow({
			getAssetVersion: (id) => readAssetVersion(qc, id),
			loadContext: (item) => loadFocusedContext(qc, item, forceThemeRef),
			loadNeighborContext: (neighbor) => loadNeighborContext(qc, neighbor),
			zTop: zHint,
		})
	}
	const previewWindow = windowInstanceRef.current

	// Claims are released only when the preview surface itself goes away.
	useEffect(() => {
		return () => previewWindow.dispose()
	}, [previewWindow])

	// Focus the window on the current target and slide it to the current
	// ±1 neighbors. Cheap on re-runs: focusing an already-claimed resId
	// neither re-claims nor re-posts.
	useEffect(() => {
		if (isInline) return
		previewWindow.focus(
			{
				pluginId,
				resId,
				resName,
				sourceMeta,
				searchMeta,
				fileStats,
				contentPluginId,
			},
			neighbors ?? [],
		)
	}, [
		isInline,
		previewWindow,
		pluginId,
		resId,
		resName,
		sourceMeta,
		searchMeta,
		fileStats,
		contentPluginId,
		neighbors,
	])

	// The flip lands in the layout phase of the same commit that updates
	// the dialog chrome: an already-painted neighbor becomes visible
	// before paint. The window's own ack-driven flip covers the
	// not-yet-ready case (the previous slot stays presented meanwhile).
	useLayoutEffect(() => {
		if (isInline) return
		previewWindow.flipNow(resId)
	}, [isInline, previewWindow, pluginId, resId])

	// Mirror the synchronous flip handle for the caller's click handlers.
	useEffect(() => {
		if (windowRef === undefined) return
		windowRef.current = { flipNow: previewWindow.flipNow }
		return () => {
			windowRef.current = null
		}
	}, [windowRef, previewWindow])

	const snapshot = useSyncExternalStore(
		previewWindow.subscribe,
		previewWindow.getSnapshot,
	)

	// Every window slot — presented or parked — tracks the placeholder's
	// geometry so the flip never waits on layout.
	useWindowGeometrySync({
		placeholder: isInline ? null : placeholder,
		window: previewWindow,
	})

	// ── Inline mode ────────────────────────────────────────────────────
	// A minimal single-slot path: the detail page never switches
	// resources in place, so the window (and its held semantics) buys
	// nothing there. Claim → re-parent into the placeholder → context
	// push (only after the post-re-parent load) → ready gate.
	const [inlineSlot, setInlineSlot] = useState<PoolClaimedEntry | null>(null)
	const [inlineReady, setInlineReady] = useState(false)
	// Produced by the mount effect: the claimed slot plus a promise that
	// resolves with the load event FOLLOWING the re-parent into the
	// placeholder (re-parenting an iframe always reloads its document).
	const [inlineFrame, setInlineFrame] = useState<{
		readonly slot: PoolClaimedEntry
		readonly whenReattached: Promise<void>
	} | null>(null)

	useEffect(() => {
		if (!isInline) return
		// No resId passed: inline mode re-parents the iframe, which
		// reloads its document and invalidates any painted state —
		// priming never applies here.
		const slot = claim({
			pluginId,
			assetVersion: readAssetVersion(qc, pluginId),
		})
		setInlineSlot(slot)
		setInlineReady(false)
		const unsubReady = slot.onReady(() => setInlineReady(true))
		return () => {
			unsubReady()
			slot.release()
			setInlineSlot(null)
		}
	}, [isInline, pluginId, qc])

	// Context push for the inline slot. The bootstrap request fires in
	// parallel with the iframe load; a same-slot resId switch re-posts
	// and swaps the plugin tree seamlessly. The push MUST wait for the
	// load that follows the re-parent (whenReattached), not the pool's
	// loaded flag: a warm pooled entry is already loaded, the re-parent
	// reloads its document, and a context posted into the pre-reload
	// document is silently dropped — the plugin's #root would never
	// mount (the blank detail-page bug).
	useEffect(() => {
		if (!isInline || inlineFrame === null) return
		const { slot, whenReattached } = inlineFrame
		let mounted = true
		void (async function push() {
			const [init] = await Promise.all([
				qc
					.fetchQuery(previewInitContextQueryOptions({ pluginId, resId }))
					.catch(() => undefined),
				whenReattached,
			])
			if (!mounted) return
			slot.postContext(
				buildPluginIframeContext({
					pluginId,
					resId,
					resName,
					sourceMeta,
					searchMeta,
					fileStats,
					contentPluginId,
					forceTheme,
					inheritFont: readInheritFont(qc, pluginId),
					init,
				}),
			)
		})()
		return () => {
			mounted = false
		}
	}, [
		isInline,
		inlineFrame,
		pluginId,
		resId,
		resName,
		sourceMeta,
		searchMeta,
		fileStats,
		contentPluginId,
		forceTheme,
		qc,
	])

	// Inline presentation is split across two effects on purpose: the
	// mount effect must NOT depend on readiness — its cleanup detaches
	// the iframe, and detaching discards the document. Only the
	// presentation effect may flip with readiness.
	useEffect(() => {
		if (!isInline || inlineSlot === null || placeholder === null) return

		const iframe = inlineSlot.iframe
		// The re-parent below reloads the iframe's document; arm the
		// one-shot listener BEFORE moving so the context-push effect can
		// await exactly the load that follows.
		let resolveReattached: () => void = () => {}
		const whenReattached = new Promise<void>((resolve) => {
			resolveReattached = resolve
		})
		iframe.addEventListener("load", resolveReattached, { once: true })
		placeholder.appendChild(iframe)
		iframe.style.position = "absolute"
		iframe.style.inset = "0"
		iframe.style.width = "100%"
		iframe.style.height = "100%"
		iframe.style.zIndex = "auto"
		iframe.style.display = "block"
		setInlineFrame({ slot: inlineSlot, whenReattached })

		return () => {
			iframe.removeEventListener("load", resolveReattached)
			setInlineFrame(null)
			// Do NOT re-parent back into the pool container: the move
			// would reload the document anyway (nothing is preserved),
			// and the pool entry would keep a stale loaded/ack state over
			// a blank, mid-reload document. Detach instead — the pool
			// destroys disconnected entries on sight.
			iframe.remove()
		}
	}, [isInline, inlineSlot, placeholder])

	useEffect(() => {
		if (!isInline || inlineSlot === null) return
		setFramePresentation(inlineSlot.iframe, inlineReady)
	}, [isInline, inlineSlot, inlineReady])

	// ── Shared status/lifecycle wiring ─────────────────────────────────
	const focusedSlot =
		snapshot.slots.find((slot) => slot.resId === snapshot.focusedResId)
			?.claim ?? null
	const activeSlot = isInline ? inlineSlot : focusedSlot
	const slotReady = isInline ? inlineReady : snapshot.focusedReady

	// The iframe the user currently sees; null on a cold open before the
	// first slot has painted.
	const presentedIframe = isInline
		? (inlineSlot?.iframe ?? null)
		: (snapshot.slots.find((slot) => slot.resId === snapshot.presentedResId)
				?.iframe ?? null)

	// The externally owned ref (fullscreen target) always points at the
	// iframe that is actually on screen.
	useEffect(() => {
		if (iframeRef === undefined) return
		iframeRef.current = presentedIframe
		return () => {
			iframeRef.current = null
		}
	}, [iframeRef, presentedIframe])

	const { status, contentVisible } = useIframeLifecycle({
		slot: activeSlot,
		placeholder,
		pluginId,
		resId,
		onError,
		slotReady,
	})

	function ref(el: HTMLElement | null): void {
		setPlaceholder(el)
	}

	return {
		ref,
		status,
		contentVisible,
		presented: isInline ? inlineReady : snapshot.presentedResId !== null,
	}
}
