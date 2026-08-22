import { booleanCodec } from "@hoardodile/sdk-web"
import { AltArrowLeftIcon as AltArrowLeft } from "@solar-icons/react/linear/alt-arrow-left"
import { AltArrowRightIcon as AltArrowRight } from "@solar-icons/react/linear/alt-arrow-right"
import { useCallback, useEffect, useMemo } from "react"
import type { GalleryPlayerOptions } from "./GalleryFileMedia"
import { GalleryFileMedia } from "./GalleryFileMedia"
import { GalleryJumpBadge } from "./GalleryJumpBadge"
import { readSourceMetaDimensions } from "./helpers"
import { usePluginAPI } from "./hooks"
import { useTranslation } from "./i18n"
import type { GalleryFile } from "./shared"
import { useGalleryIndex } from "./useGalleryIndex"

export type { GalleryPlayerOptions } from "./GalleryFileMedia"

export type GalleryViewProps = {
	readonly mediaFiles: readonly GalleryFile[]
	readonly onCurrentFileChange: (file: GalleryFile | undefined) => void
	readonly hideSendBar: boolean
	readonly playerOptions?: GalleryPlayerOptions
	/**
	 * Controlled current-file index. When provided together with
	 * {@link onFileIndexChange}, the gallery becomes URL-driven so callers
	 * can persist the position in route search params.
	 */
	readonly currentFileIndex?: number
	readonly onFileIndexChange?: (index: number) => void
	/**
	 * Pre-known total count from `fileStats.count`. Used for the nav
	 * badge / prev-next disabled state before `api.useFileList()` resolves.
	 * When absent, falls back to `mediaFiles.length`.
	 */
	readonly expectedCount?: number
}

export function GalleryView(props: GalleryViewProps) {
	const api = usePluginAPI()
	const {
		mediaFiles,
		onCurrentFileChange,
		hideSendBar,
		playerOptions,
		currentFileIndex,
		onFileIndexChange,
		expectedCount,
	} = props
	const { t } = useTranslation()

	const [useOriginal, setUseOriginal] = api.usePref(
		"viewOriginal",
		false,
		booleanCodec(),
	)
	const toggleUseOriginal = useCallback(() => {
		setUseOriginal(!useOriginal)
	}, [setUseOriginal, useOriginal])

	const count = mediaFiles.length
	const { index, setIndex } = useGalleryIndex({
		count,
		value: currentFileIndex,
		onChange: onFileIndexChange,
	})
	const effectiveCount = Math.max(count, expectedCount ?? 0)

	const file = mediaFiles[index]
	useEffect(() => {
		onCurrentFileChange(file)
	}, [file, onCurrentFileChange])

	const sourceMetaSize = useMemo(() => {
		const dims = readSourceMetaDimensions(api.resource.sourceMeta)
		if (dims.width === undefined || dims.height === undefined) return undefined
		return { w: dims.width, h: dims.height }
	}, [api.resource.sourceMeta])

	const goPrev = useCallback(() => {
		setIndex(index - 1)
	}, [setIndex, index])
	const goNext = useCallback(() => {
		setIndex(index + 1)
	}, [setIndex, index])

	if (file === undefined) return null

	const src = api.resolveFileUrl(
		file.filename,
		!useOriginal && file.type === "image" && file.preview
			? "preview"
			: "original",
	)

	return (
		<div className="relative flex h-full w-full items-center justify-center">
			{file.type === "image" && file.preview && (
				<button
					type="button"
					onClick={toggleUseOriginal}
					className="absolute right-2 top-2 z-10 rounded bg-black/60 px-2 py-1 text-xs text-white transition-colors hover:bg-black/80"
				>
					{useOriginal ? t("showPreview") : t("showOriginal")}
				</button>
			)}
			<GalleryFileMedia
				file={file}
				src={src}
				hideSendBar={hideSendBar}
				playerOptions={playerOptions}
				naturalSize={sourceMetaSize}
				showClickZones={count > 1}
				onPrev={goPrev}
				onNext={goNext}
			/>
			{count > 1 && (
				<>
					<GalleryNavButton
						side="left"
						label={t("nav.prev")}
						disabled={index === 0}
						onClick={goPrev}
					/>
					<GalleryNavButton
						side="right"
						label={t("nav.next")}
						disabled={index === count - 1}
						onClick={goNext}
					/>
					<GalleryJumpBadge
						index={index}
						count={effectiveCount}
						onJump={setIndex}
					/>
				</>
			)}
		</div>
	)
}

function GalleryNavButton(props: {
	readonly side: "left" | "right"
	readonly label: string
	readonly disabled: boolean
	readonly onClick: () => void
}) {
	const { side, label, disabled, onClick } = props
	const Icon = side === "left" ? AltArrowLeft : AltArrowRight
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`absolute ${side === "left" ? "left-2" : "right-2"} top-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-30`}
		>
			<Icon className="h-6 w-6" />
		</button>
	)
}
