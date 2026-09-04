import { useEffect, useRef, useState } from "react"

/**
 * Fetch an existing image (e.g. a resource cover or a character avatar /
 * fullbody) and expose it as an object URL suitable for re-cropping.
 *
 * Returns `undefined` while loading, when `url` is `undefined`, or when the
 * server answers with anything other than a 2xx (e.g. a 404 "no image" for a
 * slot that has no file) — so callers can keep their empty "pick an image"
 * frame when there is nothing to preload.
 *
 * The fetch bypasses the HTTP cache (`cache: "no-store"`): these slot images
 * are mutable (cover replace/delete, avatar re-upload) and their URLs carry
 * no version parameter, so a stale entry — e.g. one cached under an older
 * immutable policy — must never resurface in the editor.
 *
 * The object URL is an ordinary `blob:` URL created from the fetched bytes,
 * and is revoked when `url` changes or the component unmounts.
 */
export function useExistingImageSrc(
	url: string | undefined,
): string | undefined {
	const [src, setSrc] = useState<string | undefined>(undefined)
	const objectUrlRef = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (url === undefined) {
			setSrc(undefined)
			return
		}

		// `url` is a (mutable) function parameter, so its type narrowing does
		// not propagate into the nested async closure below. Capture the
		// narrowed `string` so `run()` can fetch it without a null check.
		const target = url

		let cancelled = false
		let abortCtrl: AbortController | undefined

		async function run() {
			try {
				abortCtrl = new AbortController()
				const res = await fetch(target, {
					credentials: "include",
					signal: abortCtrl.signal,
					cache: "no-store",
				})
				if (!res.ok) return
				const blob = await res.blob()
				if (cancelled) return
				const objectUrl = URL.createObjectURL(blob)
				objectUrlRef.current = objectUrl
				setSrc(objectUrl)
			} catch (err) {
				if (cancelled) return
				if (err instanceof Error && err.name === "AbortError") return
				setSrc(undefined)
			}
		}

		void run()

		return () => {
			cancelled = true
			abortCtrl?.abort()
			// Revoke the previous snapshot when `url` changes or on unmount.
			if (objectUrlRef.current !== undefined) {
				URL.revokeObjectURL(objectUrlRef.current)
				objectUrlRef.current = undefined
			}
		}
	}, [url])

	return src
}
