import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Spinner } from "@hoardodile/ui/components/spinner"
import {
	AltArrowLeft,
	AltArrowRight,
	Download,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAnchorJump, usePluginAPI } from "./hooks"
import { useTranslation } from "./i18n"
import { openPdfDocument, pageNaturalSize, renderPdfPage } from "./pdf"

type DocState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly doc: PDFDocumentProxy }
	| { readonly status: "error" }

/** Pages always render fit-to-width; no zoom controls in v1. */
export function PdfViewer() {
	const api = usePluginAPI()
	const { t } = useTranslation()
	const { data: files } = api.useFileList()

	const [activeFile, setActiveFile] = useState(0)
	const [docState, setDocState] = useState<DocState>({ status: "loading" })
	const [currentPage, setCurrentPage] = useState(1)
	const [containerWidth, setContainerWidth] = useState(0)

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

	// ── container width for fit-to-width scaling ──────────────────────────
	useEffect(() => {
		const el = containerRef.current
		if (el === null) return
		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.contentRect
			if (box !== undefined) setContainerWidth(box.width)
		})
		observer.observe(el)
		setContainerWidth(el.clientWidth)
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
								containerWidth={containerWidth}
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
	containerWidth,
	register,
}: {
	readonly doc: PDFDocumentProxy
	readonly index: number
	readonly containerWidth: number
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
		if (page === undefined || containerWidth <= 0) {
			return { scale: undefined, heightPx: 220 }
		}
		const size = pageNaturalSize(page)
		// Default and only mode: fit to the container width.
		const scale = Math.max(0.1, containerWidth / size.width)
		return { scale, heightPx: size.height * scale }
	}, [page, containerWidth])

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
				<PageCanvas page={page} scale={scale} />
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
}: {
	readonly page: PDFPageProxy
	readonly scale: number
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [renderError, setRenderError] = useState(false)
	const { t } = useTranslation()

	useEffect(() => {
		const canvas = canvasRef.current
		if (canvas === null) return
		setRenderError(false)
		void renderPdfPage(page, canvas, scale).catch((err) => {
			console.warn("[plugin-pdf] page render failed", err)
			setRenderError(true)
		})
	}, [page, scale])

	if (renderError) {
		return (
			<div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
				{/* Rendered once the page data is actually usable; a failed
				    render must never look like a loading state. */}
				{t("renderError")}
			</div>
		)
	}

	return (
		<div className="relative h-full w-full">
			<canvas ref={canvasRef} className="h-full w-full" aria-label="page" />
		</div>
	)
}
