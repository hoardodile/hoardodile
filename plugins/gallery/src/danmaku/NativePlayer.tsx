import { cn } from "@hoardodile/ui/lib/utils"
import { createPlayer } from "@videojs/react"
import { Video, VideoSkin, videoFeatures } from "@videojs/react/video"
import { useRef } from "react"
import { useTranslation } from "../i18n"
import { useAutoplayPref, useControlledPlayback } from "./hooks"
import type { PlayerEngine } from "./types"
import { initialAspectRatio, type VideoSize } from "./video-fit"

/**
 * The plain `@videojs/react` reference player: no danmaku, no resume, no
 * custom chrome. It exists as the escape hatch when the enhanced surface
 * misbehaves, and owns its own provider so the two never share store
 * state.
 */

const NativeVideoPlayer = createPlayer({
	features: videoFeatures,
	displayName: "DanmakuPlayer.Native",
})

export type NativePlayerProps = {
	readonly src: string
	readonly autoplay?: boolean
	readonly loop?: boolean
	readonly className?: string
	readonly preload?: "none" | "metadata" | "auto"
	readonly naturalSize?: VideoSize
	readonly playing?: boolean
	readonly onEngineChange: (next: PlayerEngine) => void
}

export function NativePlayer(props: NativePlayerProps) {
	const {
		src,
		autoplay,
		loop,
		className,
		preload,
		naturalSize,
		playing,
		onEngineChange,
	} = props
	const { autoplay: autoplayPrefValue } = useAutoplayPref()
	const { t } = useTranslation()
	const videoRef = useRef<HTMLVideoElement>(null)
	useControlledPlayback(videoRef, playing)

	return (
		<NativeVideoPlayer.Provider>
			<div
				className={cn(
					"relative flex h-full w-full flex-col overflow-hidden bg-black",
					className,
				)}
			>
				<VideoSkin>
					<Video
						ref={videoRef}
						src={src}
						autoPlay={autoplay ?? autoplayPrefValue}
						loop={loop}
						playsInline
						preload={preload ?? "metadata"}
						crossOrigin="anonymous"
						style={{ aspectRatio: initialAspectRatio(naturalSize) }}
					/>
				</VideoSkin>
				<button
					type="button"
					onClick={() => {
						onEngineChange("enhanced")
					}}
					className="absolute right-2 top-2 z-10 rounded-full bg-black/60 px-2 py-0.5 font-mono text-tiny text-white/85 hover:bg-black/80"
				>
					{t("player.engineNative")}
				</button>
			</div>
		</NativeVideoPlayer.Provider>
	)
}
