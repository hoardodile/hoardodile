import { cn } from "@hoardodile/ui"
import { useEffect, useRef, useState } from "react"
import { apiPaths } from "@/lib/paths"

export type CharThumbProps = {
	readonly charId: string
	readonly variant: "avatar" | "fullbody"
	/**
	 * When metadata for the character changes (upload / edit) the server
	 * bumps `updatedAt`; we pass it through as a cache-buster so the
	 * browser does not keep serving a stale placeholder it saw before the
	 * first image was uploaded.
	 */
	readonly cacheKey: number
	/** Displayed centered in the tile when no image has been uploaded yet. */
	readonly name?: string
	/**
	 * Empty-tile label: `"name"` (default) shows the full name — used by
	 * cards. `"initial"` shows the first grapheme — used by compact chips
	 * where the full name cannot fit.
	 */
	readonly nameFallback?: "name" | "initial"
	readonly alt?: string
	readonly className?: string
	/**
	 * Render the white hover overlay that fades in on pointer enter.
	 * Defaults to `true`. Pass `false` for compact uses (chips) where
	 * hovering should not visually highlight the avatar.
	 */
	readonly hoverOverlay?: boolean
}

/**
 * Thumbnail tile for a character avatar or fullbody image. Hits the
 * auth-guarded HTTP endpoint (`/api/characters/:id/thumb/:variant`), which
 * answers 404 when the character has no image — the `<img>` is then removed
 * and the tile renders the character name (or its initial, for chips).
 *
 * Rounded thumbnail with cover-fit image and a white hover overlay that
 * fades in on pointer enter. Cursor is owned by the interactive wrapper
 * (link or button), not the tile itself.
 */
export function CharThumb(props: CharThumbProps) {
	const {
		charId,
		variant,
		cacheKey,
		name,
		nameFallback = "name",
		alt,
		className,
		hoverOverlay = true,
	} = props
	const [loaded, setLoaded] = useState(false)
	const [broken, setBroken] = useState(false)
	const imgRef = useRef<HTMLImageElement>(null)

	useEffect(() => {
		setLoaded(false)
		setBroken(false)
	}, [cacheKey])

	// Browsers fire the `load` event synchronously when an <img> is mounted
	// with a fully cached `src` (e.g. fast back-navigation). React attaches
	// `onLoad` after that, so the handler never runs and `loaded` stays
	// false forever. Detect the already-complete case here and recover.
	useEffect(() => {
		const el = imgRef.current
		if (el === null) return
		if (el.complete && el.naturalWidth > 0) {
			setLoaded(true)
		} else if (el.complete && el.naturalWidth === 0) {
			setBroken(true)
		}
	})

	const src = `${apiPaths.characters.thumb(charId, variant)}?v=${cacheKey}`
	return (
		<div
			className={cn(
				"group relative overflow-hidden rounded-xl nopan",
				broken && "bg-muted",
				className,
			)}
			data-testid={`character-thumb-${charId}-${variant}`}
			data-state={loaded ? "loaded" : broken ? "empty" : "pending"}
		>
			{broken ? null : (
				<img
					ref={imgRef}
					src={src}
					alt={alt ?? ""}
					className="h-full w-full object-cover object-center"
					style={{ opacity: loaded ? 1 : 0 }}
					loading="lazy"
					decoding="async"
					onLoad={() => setLoaded(true)}
					onError={() => setBroken(true)}
					data-testid={`character-thumb-img-${charId}-${variant}`}
				/>
			)}
			{/* White hover overlay that fades in on pointer enter. */}
			{hoverOverlay ? (
				<div className="pointer-events-none absolute inset-0 bg-white opacity-0 transition-opacity duration-300 group-hover:opacity-20" />
			) : null}
			{broken ? (
				<span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-1 text-center text-base font-bold">
					{nameFallback === "initial" ? nameInitial(name) : (name ?? "")}
				</span>
			) : null}
		</div>
	)
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
})

/** First grapheme of a display name, uppercased; empty when missing. */
function nameInitial(name: string | undefined): string {
	if (name === undefined) return ""
	const trimmed = name.trim()
	if (trimmed.length === 0) return ""
	for (const { segment } of graphemeSegmenter.segment(trimmed)) {
		return segment.toLocaleUpperCase()
	}
	return ""
}
