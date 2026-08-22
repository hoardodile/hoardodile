import { useEffect, useRef } from "react"
import { DanmakuPlayer } from "./danmaku/DanmakuPlayer"
import type { DanmakuSettings } from "./danmaku/types"
import { GalleryClickZones } from "./GalleryClickZones"
import type { GalleryFile } from "./shared"

/**
 * Player customisation hook. Forwarded straight through to the
 * underlying {@link DanmakuPlayer} when the active file is a video.
 */
export type GalleryPlayerOptions = {
	readonly autoplay?: boolean
	readonly loop?: boolean
	readonly playing?: boolean
	readonly controls?: "full" | "seek-only" | "none"
	readonly disableResume?: boolean
	readonly settings?: DanmakuSettings
	readonly onSettingsChange?: (next: DanmakuSettings) => void
	/** Forwarded to the underlying `<DanmakuPlayer preload>`. */
	readonly preload?: "none" | "metadata" | "auto"
}

export type GalleryFileMediaProps = {
	readonly file: GalleryFile
	readonly src: string
	readonly hideSendBar: boolean
	readonly playerOptions?: GalleryPlayerOptions
	readonly naturalSize?: { readonly w: number; readonly h: number }
	readonly showClickZones?: boolean
	readonly onPrev?: () => void
	readonly onNext?: () => void
}

/** Renders the active file with the surface its media type calls for. */
export function GalleryFileMedia(props: GalleryFileMediaProps) {
	const {
		file,
		src,
		hideSendBar,
		playerOptions,
		naturalSize,
		showClickZones,
		onPrev,
		onNext,
	} = props
	if (file.type === "video") {
		return (
			<DanmakuPlayer
				key={src}
				filename={file.filename}
				src={src}
				autoplay={playerOptions?.autoplay}
				loop={playerOptions?.loop}
				playing={playerOptions?.playing}
				controls={playerOptions?.controls}
				disableResume={playerOptions?.disableResume}
				settings={playerOptions?.settings}
				onSettingsChange={playerOptions?.onSettingsChange}
				preload={playerOptions?.preload}
				naturalSize={naturalSize}
				hideSendBar={hideSendBar}
				className="max-h-full max-w-full"
			/>
		)
	}
	if (file.type === "audio") {
		return (
			<div className="flex flex-col items-center gap-3 px-6 py-8 text-white">
				<span className="max-w-[80vw] truncate rounded bg-black/60 px-3 py-1 text-sm">
					{file.filename}
				</span>
				<GalleryAudio
					key={src}
					src={src}
					autoplay={playerOptions?.autoplay ?? true}
					paused={playerOptions?.playing === false}
				/>
			</div>
		)
	}
	return (
		<div className="relative flex h-full w-full items-center justify-center">
			{showClickZones && onPrev !== undefined && onNext !== undefined && (
				<GalleryClickZones onPrev={onPrev} onNext={onNext} />
			)}
			<img
				src={src}
				alt={file.filename}
				decoding="async"
				fetchPriority="high"
				className="max-h-full max-w-full object-contain"
			/>
		</div>
	)
}

function GalleryAudio(props: {
	readonly src: string
	readonly autoplay: boolean
	readonly paused: boolean
}) {
	const { src, autoplay, paused } = props
	const ref = useRef<HTMLAudioElement>(null)
	// `autoPlay` only applies at mount, so mirror the video player's
	// controlled playback: pause imperatively when the surface parks.
	useEffect(() => {
		if (paused) ref.current?.pause()
	}, [paused])
	return (
		// biome-ignore lint/a11y/useMediaCaption: audio files in galleries don't ship caption tracks
		<audio
			ref={ref}
			src={src}
			controls
			autoPlay={autoplay}
			className="min-w-80"
		/>
	)
}
