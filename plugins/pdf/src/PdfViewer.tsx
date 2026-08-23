import { booleanCodec, numberCodec } from "@hoardodile/sdk-web"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Spinner } from "@hoardodile/ui/components/spinner"
import {
	AltArrowLeft,
	AltArrowRight,
	Download,
	MagnifierZoomIn,
	MagnifierZoomOut,
	Maximize,
	Minimize,
	TextFormat,
	UndoLeftRound,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAnchorJump, usePluginAPI } from "./hooks"
import { useTranslation } from "./i18n"
import { openPdfDocument, pageNaturalSize, renderPdfPage } from "./pdf"

/** How the page scale is chosen: a fit mode, or `null` while manual. */
type FitMode = "fit-width" | "fit-page"

type DocState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly doc: PDFDocumentProxy }
	| { readonly status: "error" }

const ZOOM_STEP = 1.1
const SCALE_MIN_PERCENT = 25
const SCALE_MAX_PERCENT = 400

export function PdfViewer() {
	const api = usePluginAPI()
	const { t } = useTranslation()
	const { data: files } = api.useFileList()

	const [activeFile, setActiveFile] = useState(0)
	const [docState, setDocState] = useState<DocState>({ status: "loading" })
	const [currentPage, setCurrentPage] = useState(1)
	const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
	const [fitMode, setFitMode] = usePrefFit()
	const [scalePercent, setScalePercent] = usePrefScale()
	const [rotation, setRotation] = usePrefRotation()
	const [showText, setShowText] = usePrefText()

	const containerRef = useRef<HTMLDivElement | null>(null)
	const shellsRef = useRef<Map<number, HTMLDivElement>>(new Map())

	const fileList = files ?? []
	const file = fileList[activeFile]
	const pageCount = docState.status === "ready" ? docState.doc.numPages : 1

	// ── document loading ──────────────────────────────────────────────────
	useEffect(() => {
		if (file === undefined) {
			setDocState(
				fileList.length > 0 ? { status: "loading" } : { status: "error" },
			)
			return
		}
		let cancelled = false
		setDocState({ status: "loading" })
		setCurrentPage(1)
		void openPdfDocument(
			api.resolveFileUrl(file.filename),
			file.sizeBytes,
			() => api.readFile(file.filename),
		)
			.then((doc) => {
				if (!cancelled) setDocState({ status: "ready", doc })
			})
			.catch(() => {
				if (!cancelled) setDocState({ status: "error" })
			})
		return () => {
			cancelled = true
		}
	}, [api, file, fileList.length])

	// ── container size for fit modes ──────────────────────────────────────
	useEffect(() => {
		const el = containerRef.current
		if (el === null) return
		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.contentRect
			if (box !== undefined) {
				setContainerSize({ width: box.width, height: box.height })
			}
		})
		observer.observe(el)
		setContainerSize({ width: el.clientWidth, height: el.clientHeight })
		return () => observer.disconnect()
	}, [])

	// ── current page from scroll position ─────────────────────────────────
	const onScroll = useCallback(() => {
		const container = containerRef.current
		if (container === null) return
		const top = container.getBoundingClientRect().top
		let nearest = 1
		for (const [index, shell] of shellsRef.current) {
			const rect = shell.getBoundingClientRect()
			if (rect.bottom > top + 12) {
				nearest = index + 1
				break
			}
		}
		setCurrentPage(nearest)
	}, [])

	const jumpToPage = useCallback((pageIndex: number) => {
		shellsRef.current.get(pageIndex)?.scrollIntoView({ behavior: "smooth" })
	}, [])

	useAnchorJump((anchor) => {
		const target = Math.min(anchor.pageIndex, Math.max(0, pageCount - 1))
		setCurrentPage(target + 1)
		jumpToPage(target)
	})

	// ── zoom ──────────────────────────────────────────────────────────────
	const effectiveScale =
		fitMode === null ? Math.max(0.05, scalePercent / 100) : undefined

	const zoomIn = useCallback(() => {
		setFitMode(null)
		setScalePercent(
			clampScalePercent(Math.round((scalePercent * ZOOM_STEP) / 5) * 5),
		)
	}, [fitMode, scalePercent, setFitMode, setScalePercent])

	const zoomOut = useCallback(() => {
		setFitMode(null)
		setScalePercent(
			clampScalePercent(Math.round(scalePercent / ZOOM_STEP / 5) * 5),
		)
	}, [fitMode, scalePercent, setFitMode, setScalePercent])

	const pickFit = useCallback(
		(mode: FitMode) => {
			setFitMode(mode)
		},
		[setFitMode],
	)

	const pickActual = useCallback(() => {
		setFitMode(null)
		setScalePercent(100)
	}, [setFitMode, setScalePercent])

	const registerShell = useCallback(
		(index: number, el: HTMLDivElement | null) => {
			if (el === null) shellsRef.current.delete(index)
			else shellsRef.current.set(index, el)
		},
		[],
	)

	if (fileList.length > 0 && file === undefined) {
		return <EmptyState title={t("error")} detail={t("errorDetail")} />
	}

	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
				{fileList.length > 1 && (
					<div className="mr-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
						{fileList.map((f, i) => (
							<Button
								key={f.filename}
								variant="ghost"
								size="sm"
								active={i === activeFile}
								aria-pressed={i === activeFile}
								onClick={() => setActiveFile(i)}
							>
								<span className="max-w-40 truncate">{f.filename}</span>
							</Button>
						))}
					</div>
				)}
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("previousPage")}
						aria-label={t("previousPage")}
						disabled={currentPage <= 1}
						onClick={() => jumpToPage(currentPage - 2)}
					>
						<Icon icon={AltArrowLeft} />
					</Button>
					<span className="px-1 whitespace-nowrap text-xs text-muted-foreground">
						{currentPage} {t("pageOf")} {pageCount}
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("nextPage")}
						aria-label={t("nextPage")}
						disabled={currentPage >= pageCount}
						onClick={() => jumpToPage(currentPage)}
					>
						<Icon icon={AltArrowRight} />
					</Button>
					<span className="mx-1 h-4 w-px bg-border" aria-hidden />
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("zoomOut")}
						aria-label={t("zoomOut")}
						onClick={zoomOut}
					>
						<Icon icon={MagnifierZoomOut} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("zoomFitWidth")}
						aria-label={t("zoomFitWidth")}
						active={fitMode === "fit-width"}
						aria-pressed={fitMode === "fit-width"}
						onClick={() => pickFit("fit-width")}
					>
						<Icon icon={Maximize} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("zoomFitPage")}
						aria-label={t("zoomFitPage")}
						active={fitMode === "fit-page"}
						aria-pressed={fitMode === "fit-page"}
						onClick={() => pickFit("fit-page")}
					>
						<Icon icon={Minimize} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("zoomActual")}
						aria-label={t("zoomActual")}
						active={fitMode === null && scalePercent === 100}
						aria-pressed={fitMode === null && scalePercent === 100}
						onClick={pickActual}
					>
						<span className="text-xs">{scalePercent}%</span>
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("zoomIn")}
						aria-label={t("zoomIn")}
						onClick={zoomIn}
					>
						<Icon icon={MagnifierZoomIn} />
					</Button>
					<span className="mx-1 h-4 w-px bg-border" aria-hidden />
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("rotate")}
						aria-label={t("rotate")}
						onClick={() => setRotation((rotation + 90) % 360)}
					>
						<Icon icon={UndoLeftRound} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title={t("textLayer")}
						aria-label={t("textLayer")}
						active={showText}
						aria-pressed={showText}
						onClick={() => setShowText(!showText)}
					>
						<Icon icon={TextFormat} />
					</Button>
					{file !== undefined && (
						<Button
							variant="ghost"
							size="icon-xs"
							title={t("download")}
							aria-label={t("download")}
							render={
								<a
									href={api.resolveFileUrl(file.filename)}
									download={file.filename}
								/>
							}
						>
							<Icon icon={Download} />
						</Button>
					)}
				</div>
			</div>

			<div
				ref={containerRef}
				onScroll={onScroll}
				className="flex-1 overflow-auto bg-muted/40"
			>
				{docState.status === "loading" && (
					<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
						<Spinner />
						{t("loading")}
					</div>
				)}
				{docState.status === "error" && (
					<EmptyState title={t("error")} detail={t("errorDetail")} />
				)}
				{docState.status === "ready" && (
					<div className="flex flex-col items-center gap-4 py-6">
						{Array.from({ length: docState.doc.numPages }, (_, i) => (
							<PageShell
								key={i}
								doc={docState.doc}
								index={i}
								fitMode={fitMode}
								effectiveScale={effectiveScale}
								rotation={rotation}
								showText={showText}
								containerSize={containerSize}
								register={registerShell}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

function EmptyState({
	title,
	detail,
}: {
	readonly title: string
	readonly detail: string
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
			<p className="text-sm font-medium">{title}</p>
			<p className="text-xs text-muted-foreground">{detail}</p>
		</div>
	)
}

// ── page rendering ───────────────────────────────────────────────────────

function PageShell({
	doc,
	index,
	fitMode,
	effectiveScale,
	rotation,
	showText,
	containerSize,
	register,
}: {
	readonly doc: PDFDocumentProxy
	readonly index: number
	readonly fitMode: FitMode | null
	readonly effectiveScale: number | undefined
	readonly rotation: number
	readonly showText: boolean
	readonly containerSize: { width: number; height: number }
	readonly register: (index: number, el: HTMLDivElement | null) => void
}) {
	const [page, setPage] = useState<PDFPageProxy>()
	const [visible, setVisible] = useState(false)
	const shellRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		let cancelled = false
		void doc.getPage(index + 1).then((p) => {
			if (!cancelled) setPage(p)
		})
		return () => {
			cancelled = true
		}
	}, [doc, index])

	useEffect(() => {
		const el = shellRef.current
		if (el === null) return
		register(index, el)
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) setVisible(entry.isIntersecting)
			},
			{ rootMargin: "250% 0px" },
		)
		observer.observe(el)
		return () => {
			observer.disconnect()
			register(index, null)
		}
	}, [index, register])

	const { scale, heightPx } = useMemo(() => {
		if (page === undefined) {
			return { scale: undefined, heightPx: 220 }
		}
		const size = pageNaturalSize(page, rotation)
		let scale: number | undefined
		if (effectiveScale !== undefined) {
			scale = effectiveScale
		} else if (containerSize.width > 0) {
			if (fitMode === "fit-page") {
				const w = containerSize.width / size.width
				const h = Math.max(containerSize.height, 1) / size.height
				scale = Math.min(w, h)
			} else {
				scale = containerSize.width / size.width
			}
		}
		if (scale === undefined) return { scale, heightPx: 220 }
		return { scale, heightPx: size.height * scale }
	}, [page, fitMode, effectiveScale, rotation, containerSize])

	return (
		<div
			ref={shellRef}
			className={cn(
				"w-full shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-card",
				"max-w-[calc(100%-4rem)]",
			)}
			style={{ height: heightPx }}
		>
			{page !== undefined && scale !== undefined && visible && (
				<PageCanvas
					page={page}
					scale={scale}
					rotation={rotation}
					showText={showText}
				/>
			)}
			{page !== undefined && scale !== undefined && !visible && (
				<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
					…
				</div>
			)}
			{page === undefined && (
				<div className="flex h-full items-center justify-center">
					<Spinner className="size-4 text-muted-foreground" />
				</div>
			)}
		</div>
	)
}

function PageCanvas({
	page,
	scale,
	rotation,
	showText,
}: {
	readonly page: PDFPageProxy
	readonly scale: number
	readonly rotation: number
	readonly showText: boolean
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if (canvas === null) return
		void renderPdfPage(page, canvas, scale, rotation)
	}, [page, scale, rotation])

	return (
		<div className="relative h-full w-full">
			<canvas ref={canvasRef} className="h-full w-full" aria-label="page" />
			<TextLayer
				page={page}
				scale={scale}
				rotation={rotation}
				showText={showText}
			/>
		</div>
	)
}

/**
 * Minimal pdf.js-style text layer: absolutely positioned text items over
 * the canvas so the user can select and copy text. Font matching is
 * approximated with `sans-serif`; exact glyph metrics stay canvas-only.
 */
function TextLayer({
	page,
	scale,
	rotation,
	showText,
}: {
	readonly page: PDFPageProxy
	readonly scale: number
	readonly rotation: number
	readonly showText: boolean
}) {
	const [items, setItems] = useState<
		readonly {
			text: string
			x: number
			y: number
			size: number
			angle: number
		}[]
	>([])

	useEffect(() => {
		if (!showText) return
		let cancelled = false
		void page.getTextContent().then((content) => {
			if (cancelled) return
			setItems(
				content.items
					.flatMap((item) => {
						if (!("str" in item) || !("transform" in item)) return []
						const [a, b, , , e, f] = item.transform
						return [
							{
								text: item.str,
								x: e ?? 0,
								y: f ?? 0,
								size: Math.hypot(a ?? 0, b ?? 0),
								angle: (Math.atan2(b ?? 0, a ?? 0) * 180) / Math.PI,
							},
						]
					})
					.filter((item) => item.text.trim().length > 0),
			)
		})
		return () => {
			cancelled = true
		}
	}, [page, showText])

	if (!showText) return null

	const viewport = page.getViewport({ scale: 1, rotation })
	return (
		<div
			className="absolute inset-0 origin-top-left"
			style={{
				transform: `scale(${scale})`,
				width: `${viewport.width}px`,
				height: `${viewport.height}px`,
			}}
		>
			{items.map((item, i) => (
				<span
					key={i}
					className="absolute whitespace-pre text-transparent"
					style={{
						left: `${item.x}px`,
						top: `${item.y}px`,
						fontSize: `${item.size}px`,
						transform: `rotate(${item.angle}deg)`,
						transformOrigin: "0 0",
						fontFamily: "sans-serif",
					}}
				>
					{item.text}
				</span>
			))}
		</div>
	)
}

// ── persisted preferences ────────────────────────────────────────────────

const PREF_FIT = "pdf.fitMode"
const PREF_SCALE = "pdf.scalePercent"
const PREF_ROTATION = "pdf.rotation"
const PREF_TEXT = "pdf.textLayer"

function clampScalePercent(v: number): number {
	return Math.min(SCALE_MAX_PERCENT, Math.max(SCALE_MIN_PERCENT, v))
}

function usePrefFit(): readonly [
	FitMode | null,
	(mode: FitMode | null) => void,
] {
	const api = usePluginAPI()
	return api.usePref<FitMode | null>(PREF_FIT, "fit-width")
}

function usePrefScale(): readonly [number, (pct: number) => void] {
	const api = usePluginAPI()
	return api.usePref(PREF_SCALE, 100, numberCodec())
}

function usePrefRotation(): readonly [number, (deg: number) => void] {
	const api = usePluginAPI()
	return api.usePref(PREF_ROTATION, 0, numberCodec())
}

function usePrefText(): readonly [boolean, (v: boolean) => void] {
	const api = usePluginAPI()
	return api.usePref(PREF_TEXT, false, booleanCodec())
}
