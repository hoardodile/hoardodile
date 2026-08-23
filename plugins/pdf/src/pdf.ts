import {
	GlobalWorkerOptions,
	getDocument,
	type PDFDocumentProxy,
	type PDFPageProxy,
} from "pdfjs-dist"
// Vite resolves the worker as an emitted asset URL.
import workerAssetUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

/** Below this size the data-mode fallback (whole bytes in memory) is allowed. */
export const DATA_FALLBACK_MAX_BYTES = 96 * 1024 * 1024

/** Preferred range chunk for the streaming (URL) path. */
export const RANGE_CHUNK_BYTES = 1024 * 1024

let workerReady: Promise<void> | undefined

/**
 * Point pdf.js at a worker. Plugin iframes are sandboxed with an opaque
 * origin, where a worker script URL is normally rejected (the document
 * origin is "null"); blob workers and pdf.js's main-thread fake-worker
 * fallback are not. So: try the bare asset URL first, then re-serve the
 * same bytes as a blob URL.
 */
export function ensurePdfWorker(): Promise<void> {
	workerReady ??= (async () => {
		const direct = new URL(workerAssetUrl, import.meta.url).href
		let src = direct
		try {
			// Probe by constructing (and dropping) a worker.
			new Worker(direct, { type: "module" }).terminate()
		} catch {
			const blob = await (await fetch(direct)).blob()
			src = URL.createObjectURL(blob)
		}
		GlobalWorkerOptions.workerSrc = src
	})()
	return workerReady
}

/**
 * Open a PDF document: progressive range streaming through the host's
 * tokenized file URL (CORS `*` + HTTP Range, exactly what pdf.js wants),
 * falling back to a full in-memory read only for small files and only
 * when the streaming path fails.
 */
export async function openPdfDocument(
	url: string,
	sizeBytes: number | undefined,
	readAll: () => Promise<ArrayBuffer>,
): Promise<PDFDocumentProxy> {
	await ensurePdfWorker()
	try {
		return await getDocument({
			url,
			// v6 streams range requests whenever a URL is given; this just
			// tunes the chunk size for the host's Range-capable file server.
			rangeChunkSize: RANGE_CHUNK_BYTES,
		}).promise
	} catch (streamError) {
		if (sizeBytes !== undefined && sizeBytes > DATA_FALLBACK_MAX_BYTES) {
			throw streamError
		}
		try {
			const data = await readAll()
			return await getDocument({ data }).promise
		} catch {
			throw streamError
		}
	}
}

/**
 * Render one page into a canvas at the given scale (CSS px per PDF pt)
 * and rotation (0/90/180/270). Cancels in-flight render work for the
 * same canvas so rapid zoom/scroll never queues stale draws.
 */
export async function renderPdfPage(
	page: PDFPageProxy,
	canvas: HTMLCanvasElement,
	scale: number,
	rotation: number,
): Promise<void> {
	const viewport = page.getViewport({ scale, rotation })
	canvas.width = Math.max(1, Math.floor(viewport.width))
	canvas.height = Math.max(1, Math.floor(viewport.height))
	const ctx = canvas.getContext("2d")
	if (ctx === null) return
	const task = page.render({ canvas, canvasContext: ctx, viewport })
	try {
		await task.promise
	} catch (err) {
		// A rendering task cancelled by zoom/scroll is the normal turnover
		// path — the caller re-renders with the new parameters.
		if (!(err instanceof Error && err.name === "RenderingCancelledException")) {
			throw err
		}
	}
}

/** Natural page size in CSS px at the given rotation (scale = 1). */
export function pageNaturalSize(
	page: PDFPageProxy,
	rotation: number,
): { readonly width: number; readonly height: number } {
	const viewport = page.getViewport({ scale: 1, rotation })
	return { width: viewport.width, height: viewport.height }
}
