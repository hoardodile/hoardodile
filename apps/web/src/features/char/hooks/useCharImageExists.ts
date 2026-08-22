import { useEffect, useState } from "react"
import { apiPaths } from "@/lib/paths"

/**
 * Whether the character has an image for the variant — the images
 * endpoint answers 404 when none is set (the thumb route would fall
 * back to a synthesised placeholder instead, so it cannot be probed).
 * `undefined` until the HEAD settles, so callers can avoid a flash.
 */
export function useCharImageExists(
	charId: string,
	variant: "avatar" | "fullbody",
): boolean | undefined {
	const [exists, setExists] = useState<boolean | undefined>(undefined)

	useEffect(() => {
		let cancelled = false
		setExists(undefined)
		fetch(apiPaths.characters.image(charId, variant), { method: "HEAD" })
			.then((res) => {
				if (!cancelled) setExists(res.ok)
			})
			.catch(() => {
				if (!cancelled) setExists(false)
			})
		return () => {
			cancelled = true
		}
	}, [charId, variant])

	return exists
}
