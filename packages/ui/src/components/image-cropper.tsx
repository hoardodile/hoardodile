import { useCallback, useEffect, useRef, useState } from "react"
import ReactCrop, { type Crop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"

/**
 * Output of {@link ImageCropper} once the user releases the selection
 * box. Contains the cropped pixel data ready to upload (PNG by default)
 * plus its dimensions.
 */
export type CroppedImage = {
	readonly blob: Blob
	readonly width: number
	readonly height: number
	readonly mimeType: string
}

export type ImageCropperProps = {
	/** The source image as a data URL or object URL. */
	readonly src: string
	/**
	 * Optional fixed aspect ratio (width / height). When omitted, the
	 * user can crop freely.
	 */
	readonly aspect?: number
	/**
	 * Output mime type. Defaults to `image/png`. PNG preserves quality;
	 * JPEG produces smaller files for photographic content.
	 */
	readonly mimeType?: "image/png" | "image/jpeg" | "image/webp"
	/** JPEG/WebP quality (0..1). Ignored for PNG. */
	readonly quality?: number
	/**
	 * Called whenever the cropped pixel rectangle changes and is non-empty.
	 * The callback receives a function that, when invoked, produces the
	 * final {@link CroppedImage}. The render is deferred to avoid running
	 * the canvas pipeline on every drag tick.
	 */
	readonly onCropReady: (render: () => Promise<CroppedImage>) => void
	/**
	 * Called synchronously with a PNG `data:` URL whenever the crop
	 * selection changes. PNG preserves alpha for the live preview (JPEG
	 * would flatten transparency to black). Unlike blob URLs, `data:`
	 * URLs never appear in the browser network tab and setting them as
	 * image `src` cannot cause an infinite re-render loop.
	 */
	readonly onPreviewChange?: (dataUrl: string) => void
	/**
	 * Max CSS width for the source image in the crop stage. When omitted the
	 * image relies on `max-w-full` to fill the parent width.
	 */
	readonly displayMaxWidth?: number | string
	/**
	 * Max CSS height for the source image in the crop stage (e.g. `80vh` for
	 * large canvas captures). Defaults to `70vh`.
	 */
	readonly displayMaxHeight?: number | string
}

/**
 * Free-aspect (or fixed-aspect when {@link ImageCropperProps.aspect} is
 * provided) image cropper. Wraps `react-image-crop` and exposes a
 * deferred `render()` callback so callers can rasterise the selection on
 * demand (typically when the user clicks "save").
 */
export function ImageCropper(props: ImageCropperProps) {
	const {
		src,
		aspect,
		mimeType = "image/png",
		quality = 0.92,
		displayMaxWidth,
		displayMaxHeight = "70vh",
	} = props

	const imgRef = useRef<HTMLImageElement | null>(null)
	const [crop, setCrop] = useState<Crop | undefined>(undefined)
	const [completed, setCompleted] = useState<Crop | undefined>(undefined)

	const handleImageLoad = useCallback(
		(e: React.SyntheticEvent<HTMLImageElement>) => {
			const { naturalWidth, naturalHeight } = e.currentTarget
			const initial = buildInitialCrop(naturalWidth, naturalHeight, aspect)
			setCrop(initial)
			setCompleted(initial)
		},
		[aspect],
	)

	const onCropReady = props.onCropReady
	const onPreviewChange = props.onPreviewChange

	useEffect(() => {
		const img = imgRef.current
		if (img === null || completed === undefined || completed.width === 0) {
			return
		}
		onCropReady(() => renderCroppedImage(img, completed, mimeType, quality))
		if (onPreviewChange !== undefined) {
			onPreviewChange(renderPreviewDataUrl(img, completed))
		}
	}, [completed, mimeType, quality, onCropReady, onPreviewChange])

	return (
		<div className="react-crop-theme flex min-h-0 w-full max-w-full flex-col items-center gap-2 overflow-hidden">
			<ReactCrop
				className="max-w-full"
				crop={crop}
				onChange={(_, percentCrop) => setCrop(percentCrop)}
				onComplete={(_, percentCrop) => setCompleted(percentCrop)}
				aspect={aspect}
				keepSelection
				ruleOfThirds
			>
				{/* biome-ignore lint/a11y/useAltText: cropper preview lacks user-supplied alt */}
				<img
					ref={imgRef}
					src={src}
					onLoad={handleImageLoad}
					className="h-auto max-w-full"
					style={{
						maxWidth: displayMaxWidth,
						maxHeight: displayMaxHeight,
					}}
				/>
			</ReactCrop>
		</div>
	)
}

function buildInitialCrop(
	imgWidth: number,
	imgHeight: number,
	aspect: number | undefined,
): Crop {
	if (aspect === undefined) {
		return { unit: "%" as const, x: 0, y: 0, width: 100, height: 100 }
	}

	const imgAspect = imgWidth / imgHeight
	let widthPct: number
	let heightPct: number

	if (imgAspect >= aspect) {
		// Image is wider (or equal) than the target aspect: fit to height,
		// crop the sides.
		heightPct = 100
		widthPct = (100 * aspect) / imgAspect
	} else {
		// Image is taller than the target aspect: fit to width, crop top/bottom.
		widthPct = 100
		heightPct = (100 * imgAspect) / aspect
	}

	return {
		unit: "%" as const,
		x: (100 - widthPct) / 2,
		y: (100 - heightPct) / 2,
		width: widthPct,
		height: heightPct,
	}
}

class CroppedImageRenderError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "CroppedImageRenderError"
	}
}

/**
 * @throws CroppedImageRenderError when the canvas context is unavailable
 *   or the browser refuses to encode the selected blob.
 */
async function renderCroppedImage(
	image: HTMLImageElement,
	crop: Crop,
	mimeType: string,
	quality: number,
): Promise<CroppedImage> {
	const sourceRect = cropToNaturalRect(image, crop)

	const canvas = document.createElement("canvas")
	canvas.width = sourceRect.sw
	canvas.height = sourceRect.sh
	const ctx = canvas.getContext("2d")
	if (ctx === null) {
		throw new CroppedImageRenderError("2d context is unavailable")
	}
	ctx.imageSmoothingQuality = "high"
	ctx.drawImage(
		image,
		sourceRect.sx,
		sourceRect.sy,
		sourceRect.sw,
		sourceRect.sh,
		0,
		0,
		sourceRect.sw,
		sourceRect.sh,
	)

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, mimeType, quality)
	})
	if (blob === null) {
		throw new CroppedImageRenderError("toBlob returned null")
	}
	return { blob, width: sourceRect.sw, height: sourceRect.sh, mimeType }
}

/**
 * Render the current crop to a PNG `data:` URL synchronously.
 *
 * Unlike {@link renderCroppedImage}, this function does NOT create a
 * `blob:` URL and therefore does not appear in the browser network tab.
 * Preview uses PNG (not JPEG) so transparent regions stay transparent.
 */
function renderPreviewDataUrl(image: HTMLImageElement, crop: Crop): string {
	const sourceRect = cropToNaturalRect(image, crop)

	const canvas = document.createElement("canvas")
	canvas.width = sourceRect.sw
	canvas.height = sourceRect.sh
	const ctx = canvas.getContext("2d", { alpha: true })
	if (ctx === null) return ""
	ctx.imageSmoothingQuality = "high"
	ctx.drawImage(
		image,
		sourceRect.sx,
		sourceRect.sy,
		sourceRect.sw,
		sourceRect.sh,
		0,
		0,
		sourceRect.sw,
		sourceRect.sh,
	)
	return canvas.toDataURL("image/png")
}

function cropToNaturalRect(
	image: HTMLImageElement,
	crop: Crop,
): { sx: number; sy: number; sw: number; sh: number } {
	const naturalWidth = image.naturalWidth
	const naturalHeight = image.naturalHeight

	if (crop.unit === "px") {
		return {
			sx: crop.x,
			sy: crop.y,
			sw: Math.max(1, Math.round(crop.width)),
			sh: Math.max(1, Math.round(crop.height)),
		}
	}

	const sx = (crop.x / 100) * naturalWidth
	const sy = (crop.y / 100) * naturalHeight
	const swRaw = (crop.width / 100) * naturalWidth
	const shRaw = (crop.height / 100) * naturalHeight
	const sw = Math.max(1, Math.round(swRaw))
	const sh = Math.max(1, Math.round(shRaw))

	return { sx, sy, sw, sh }
}
