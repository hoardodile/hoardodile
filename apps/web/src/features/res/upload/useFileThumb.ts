import { useEffect, useRef, useState } from "react"
import { apiPaths } from "@/lib/paths"
import { isThumbnailable } from "./clientThumbnail"

export type ThumbState =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly url: string }
	| { readonly kind: "unsupported" }
	| { readonly kind: "error" }

/** Delay before triggering the backend preview fetch. */
const BACKEND_PREVIEW_DEBOUNCE_MS = 300

/**
 * Lazy backend preview thumbnail for a staged file.
 *
 * The preview is fetched from
 * `GET /api/uploads/staged/:fileId/preview` after the tile enters the
 * viewport **and** the file's own `stagedFileId` exists — every file
 * gets its thumbnail as soon as it finishes staging, without waiting
 * for the rest of the batch. Results are cached by `File` object so
 * reordering does not regenerate the preview for the same file.
 */
export function useFileThumb(
	stagedFileId: string | undefined,
	file: File,
	enabled: boolean,
): ThumbState {
	const [thumb, setThumb] = useState<ThumbState>(() =>
		isThumbnailable(file) ? { kind: "loading" } : { kind: "unsupported" },
	)
	const cacheRef = useRef<{ file: File; url: string } | null>(null)

	useEffect(() => {
		if (!isThumbnailable(file)) {
			setThumb({ kind: "unsupported" })
			return
		}

		// Evict stale cache when the File object changes.
		if (cacheRef.current && cacheRef.current.file !== file) {
			URL.revokeObjectURL(cacheRef.current.url)
			cacheRef.current = null
		}

		// Cache hit — reuse the existing object URL. Preview content is derived
		// from the file itself, so the cached blob remains valid even when the
		// stagedFileId changes (reorder or restaging).
		if (cacheRef.current && cacheRef.current.file === file) {
			setThumb({ kind: "ready", url: cacheRef.current.url })
			return
		}

		if (stagedFileId === undefined) {
			setThumb({ kind: "loading" })
			return
		}
		if (!enabled) return

		setThumb({ kind: "loading" })
		let cancelled = false
		let abortCtrl: AbortController | undefined
		let debounceTimer: ReturnType<typeof setTimeout> | undefined

		async function run() {
			// Debounce: only fetch after the tile has been in view for
			// a short while. Prevents wasteful requests during fast scrolls.
			await new Promise<void>((resolve) => {
				debounceTimer = setTimeout(resolve, BACKEND_PREVIEW_DEBOUNCE_MS)
			})
			if (cancelled) return

			try {
				abortCtrl = new AbortController()
				const res = await fetch(apiPaths.uploads.stagedPreview(stagedFileId!), {
					credentials: "include",
					signal: abortCtrl.signal,
				})
				if (!res.ok) {
					const text = await res.text().catch(() => "")
					throw new Error(text || `preview fetch failed (${res.status})`)
				}
				const blob = await res.blob()
				if (cancelled) return
				const url = URL.createObjectURL(blob)
				cacheRef.current = { file, url }
				setThumb({ kind: "ready", url })
			} catch (err) {
				if (cancelled) return
				if (
					err instanceof Error &&
					(err.name === "AbortError" || err.message === "aborted")
				) {
					return
				}
				setThumb({ kind: "error" })
			}
		}

		run()

		return () => {
			cancelled = true
			clearTimeout(debounceTimer)
			abortCtrl?.abort()
		}
	}, [file, enabled, stagedFileId])

	// Cleanup cached object URL on unmount.
	useEffect(() => {
		return () => {
			if (cacheRef.current) {
				URL.revokeObjectURL(cacheRef.current.url)
				cacheRef.current = null
			}
		}
	}, [])

	return thumb
}

/**
 * Track whether `node` is currently visible inside `root` (with a
 * 200 px margin). When `root` is omitted the viewport is used.
 * Returns `true` while intersecting and `false` when it scrolls out.
 * This lets consumers cancel work (e.g. preview fetches) when the item
 * is no longer visible.
 */
export function useInView(
	node: HTMLElement | null,
	root: HTMLElement | null = null,
): boolean {
	const [inView, setInView] = useState(false)
	useEffect(() => {
		if (node === null) return
		if (typeof IntersectionObserver === "undefined") {
			setInView(true)
			return
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const isIntersecting = entries.some((e) => e.isIntersecting)
				setInView(isIntersecting)
			},
			{ root, rootMargin: "200px" },
		)
		observer.observe(node)
		return () => observer.disconnect()
	}, [node, root])
	return inView
}
