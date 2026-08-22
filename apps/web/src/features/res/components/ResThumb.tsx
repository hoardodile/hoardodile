import { cn } from "@hoardodile/ui"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { apiPaths } from "@/lib/paths"

export type ResThumbUrlOptions = {
	/**
	 * Optional cache-buster (`v=`). Omitted for list cards so the browser can
	 * reuse one URL across meta backfill, pagination, and refresh.
	 */
	readonly cacheKey?: number | string
	/** Client-side bust after explicit cache clears (`bust=`). */
	readonly bust?: number
}

export function buildResThumbUrl(
	resId: string,
	options?: ResThumbUrlOptions,
): string {
	const base = `${apiPaths.resources.cover(resId)}?size=thumb`
	const params: string[] = []
	if (options?.cacheKey !== undefined) {
		params.push(`v=${options.cacheKey}`)
	}
	if (options?.bust !== undefined) {
		params.push(`bust=${options.bust}`)
	}
	return params.length === 0 ? base : `${base}&${params.join("&")}`
}

export type ResThumbProps = {
	readonly resId: string
	readonly cacheKey?: number | string
	readonly bust?: number
	/** Displayed centered in the tile when no image has been uploaded yet. */
	readonly name?: string
	/**
	 * Replaces the default name-based empty content. Rendered in the tile
	 * when no image exists.
	 */
	readonly emptyContent?: ReactNode
	readonly alt?: string
	readonly className?: string
	readonly maxWidth?: number
	readonly maxHeight?: number
	/**
	 * When true, the image stretches to fill the tile (`object-cover`) and
	 * the `maxWidth`/`maxHeight` clamps are skipped. For tiles whose box is
	 * derived from the cover's aspect ratio (fit-height strips), the clamp
	 * would render the file smaller than the box and leave blank space.
	 */
	readonly fill?: boolean
	/**
	 * When true, request the image eagerly (`loading="eager"` +
	 * `fetchpriority="high"`). Used by the resource feed to fast-load
	 * the active card's poster while neighbours stay lazy.
	 */
	readonly eager?: boolean
	/**
	 * When true, skip the cover request and show the empty tile immediately.
	 * Cards do not pass this — they always probe the thumb so reconstruction
	 * can run. Left for non-card callers that already know the slot is empty.
	 */
	readonly knownEmpty?: boolean
}

/**
 * Thumbnail tile for a resource. Hits the auth-guarded HTTP endpoint
 * (`/api/resources/:id/cover?size=thumb`), which answers 404 when the
 * resource has no preview source — the `<img>` is then removed and the
 * tile renders {@link ResThumbProps.emptyContent} (or the resource name)
 * instead.
 *
 * Visual style mirrors {@link CharThumb}: rounded corners, cover-fit
 * image, and a white hover overlay that fades in on pointer enter.
 */
export function ResThumb(props: ResThumbProps) {
	const {
		resId,
		cacheKey,
		bust,
		name,
		emptyContent,
		alt,
		className,
		maxWidth,
		maxHeight,
		fill,
		eager,
		knownEmpty = false,
	} = props
	const [loaded, setLoaded] = useState(false)
	const [broken, setBroken] = useState(knownEmpty)
	const imgRef = useRef<HTMLImageElement>(null)
	const src = buildResThumbUrl(resId, { cacheKey, bust })

	useEffect(() => {
		setLoaded(false)
		setBroken(knownEmpty)
	}, [src, knownEmpty])

	useEffect(() => {
		const el = imgRef.current
		if (el === null) return
		if (el.complete && el.naturalWidth > 0) {
			setLoaded(true)
		} else if (el.complete && el.naturalWidth === 0) {
			setBroken(true)
		}
	})

	return (
		<div
			// `cn` resolves the position conflict: the media thumb passes an
			// `absolute` layer class that must beat the default `relative`,
			// otherwise the broken (no-cover) tile collapses to zero height
			// and clips its centered empty content.
			className={cn(
				"relative overflow-hidden",
				(broken || knownEmpty) && "bg-muted",
				className,
			)}
			data-testid={`resource-thumb-${resId}`}
			data-state={
				loaded ? "loaded" : knownEmpty || broken ? "empty" : "pending"
			}
		>
			<div className="pointer-events-none absolute inset-0 bg-white opacity-0 transition-opacity duration-300" />
			{knownEmpty || broken ? (
				<div
					className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-1 text-center"
					data-testid={`resource-thumb-empty-${resId}`}
				>
					{emptyContent ?? (
						<span className="line-clamp-2 text-base font-bold">{name}</span>
					)}
				</div>
			) : (
				<img
					ref={imgRef}
					src={src}
					alt={alt ?? ""}
					className={fill ? "h-full w-full object-cover" : undefined}
					style={{
						opacity: loaded ? 1 : 0,
						maxWidth: fill ? undefined : maxWidth,
						maxHeight: fill ? undefined : maxHeight,
					}}
					loading={eager === true ? "eager" : "lazy"}
					fetchPriority={eager === true ? "high" : "auto"}
					decoding="async"
					onLoad={() => setLoaded(true)}
					onError={() => setBroken(true)}
					data-testid={`resource-thumb-img-${resId}`}
				/>
			)}
		</div>
	)
}
