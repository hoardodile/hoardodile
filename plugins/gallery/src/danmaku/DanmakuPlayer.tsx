import type { Danmaku as DanmakuRecord } from "@hoardodile/sdk-web"
import { useAnchorJump, usePluginAPI } from "../hooks"
import "@videojs/react/video/skin.css"
import { useBelowMd } from "@hoardodile/ui/hooks/use-mobile"
import { cn } from "@hoardodile/ui/lib/utils"
import { createPlayer } from "@videojs/react"
import { Video, videoFeatures } from "@videojs/react/video"
import { useState } from "react"
import { DanmakuSendBar } from "./DanmakuSendBar"
import { noopReject, toEngineComment } from "./helpers"
import {
	useAutoplayPref,
	useControlledPlayback,
	useDanmakuEngine,
	useFitMode,
	useInitialVolume,
	usePlayerEngine,
	useResumeApply,
	useResumePlayback,
} from "./hooks"
import { NativePlayer } from "./NativePlayer"
import { PlayerControls } from "./PlayerControls"
import { PlayerPortalContainerContext } from "./PlayerPortalContext"
import {
	type DanmakuPlayerProps,
	type DanmakuSettings,
	DEFAULT_DANMAKU_SETTINGS,
	type PlayerEngine,
} from "./types"
import { useDanmakuPlayerRefs } from "./useDanmakuPlayerRefs"
import { useControlsAutoHide, usePlayerController } from "./usePlayerController"
import { readNaturalSize, resolveVideoFit, type VideoSize } from "./video-fit"

/**
 * Bullet-comment ("danmaku") video player. Wraps a native `<video>`
 * with a Danmaku.js overlay and a shadcn control bar; persists the
 * playback offset per file (in the resource-scoped plugin cache) so
 * reopening resumes from the last known position.
 *
 * The persisted engine preference selects between two independent
 * surfaces (mounting one swaps out the other):
 *  - `enhanced` — custom danmaku stack with shadcn UI.
 *  - `native`   — plain `@videojs/react` skin, no danmaku/resume
 *                 ({@link NativePlayer}). Reference fallback when the
 *                 custom UI misbehaves.
 */
export function DanmakuPlayer(props: DanmakuPlayerProps) {
	const { engine, setEngine: handleEngineChange } = usePlayerEngine()
	if (engine === "native") {
		return (
			<NativePlayer
				src={props.src}
				autoplay={props.autoplay}
				loop={props.loop}
				playing={props.playing}
				className={props.className}
				preload={props.preload}
				naturalSize={props.naturalSize}
				onEngineChange={handleEngineChange}
			/>
		)
	}
	return (
		<EnhancedPlayer
			{...props}
			engine={engine}
			onEngineChange={handleEngineChange}
		/>
	)
}

const EnhancedVideoPlayer = createPlayer({
	features: videoFeatures,
	displayName: "DanmakuPlayer",
})

type EnhancedPlayerProps = DanmakuPlayerProps & {
	readonly engine: PlayerEngine
	readonly onEngineChange: (next: PlayerEngine) => void
}

function EnhancedPlayer(props: EnhancedPlayerProps) {
	return (
		<EnhancedVideoPlayer.Provider>
			<EnhancedPlayerInner {...props} />
		</EnhancedVideoPlayer.Provider>
	)
}

/** Reactive playback state, one store subscription per changing slice. */
function usePlaybackState() {
	return {
		store: EnhancedVideoPlayer.usePlayer(),
		paused: EnhancedVideoPlayer.usePlayer((s) => Boolean(s.paused)),
		currentMs: Math.round(
			EnhancedVideoPlayer.usePlayer((s) => Number(s.currentTime) || 0) * 1000,
		),
		durationMs: Math.round(
			EnhancedVideoPlayer.usePlayer((s) => Number(s.duration) || 0) * 1000,
		),
		volume: EnhancedVideoPlayer.usePlayer((s) => Number(s.volume) || 0),
		muted: EnhancedVideoPlayer.usePlayer((s) => Boolean(s.muted)),
		rate: EnhancedVideoPlayer.usePlayer((s) => Number(s.playbackRate) || 1),
		fullscreen: EnhancedVideoPlayer.usePlayer((s) => Boolean(s.fullscreen)),
	}
}

function EnhancedPlayerInner(props: EnhancedPlayerProps) {
	const {
		filename = "",
		src,
		autoplay,
		loop,
		playing,
		controls = "full",
		disableResume = false,
		className,
		hideSendBar = false,
		settings: settingsProp,
		onSettingsChange,
		preload,
		naturalSize,
		engine,
		onEngineChange,
	} = props
	const api = usePluginAPI()
	const {
		videoRef,
		stageRef,
		danmakuRef,
		portalContainer,
		setPortalContainer,
	} = useDanmakuPlayerRefs()

	const playback = usePlaybackState()
	const { store, paused, currentMs, durationMs } = playback
	const isBelowMd = useBelowMd()

	const [internalSettings, setInternalSettings] = useState<DanmakuSettings>(
		DEFAULT_DANMAKU_SETTINGS,
	)
	// `settings` may be controlled by the caller (so the popover can live
	// outside the player subtree). When uncontrolled we keep our own copy.
	const settings = settingsProp ?? internalSettings
	function setSettings(next: DanmakuSettings) {
		if (onSettingsChange !== undefined) onSettingsChange(next)
		else setInternalSettings(next)
	}

	const { fitMode, setFitMode } = useFitMode()
	// Source resolution, captured on `loadedmetadata`; drives the
	// `natural` fit mode's upscale cap.
	const [natural, setNatural] = useState<VideoSize | undefined>(undefined)

	const { showControls, revealControls, cancelAutoHide } = useControlsAutoHide({
		enabled: isBelowMd,
		paused,
		resetKey: filename,
	})
	const controller = usePlayerController({
		store,
		videoRef,
		paused,
		muted: playback.muted,
		onInteraction: cancelAutoHide,
	})

	const danmakuList = api.useDanmakuList({ kind: "videoTime", filename }).data
	useDanmakuEngine({
		stageRef,
		videoRef,
		danmakuRef,
		comments: danmakuList,
		settings,
	})
	useInitialVolume({ store, duration: durationMs / 1000 })
	useResumePlayback({
		videoRef,
		filename,
		currentMs,
		durationMs,
		disabled: disableResume,
	})
	const { lastResumedAt } = useResumeApply({
		videoRef,
		filename,
		disabled: disableResume,
	})
	useControlledPlayback(videoRef, playing)

	useAnchorJump(function handleAnchorJump(anchor) {
		if (anchor.filename !== filename) return
		const video = videoRef.current
		if (video === null) return
		// Preserve play/pause state when jumping from a danmaku anchor.
		const wasPlaying = !video.paused
		video.currentTime = Math.max(0, anchor.timeMs) / 1000
		if (wasPlaying) video.play().catch(noopReject)
	})

	const { autoplay: autoplayPrefValue, setAutoplay: handleAutoplayChange } =
		useAutoplayPref()

	function handleVideoClick() {
		// On mobile a tap first brings the hidden chrome back; only a
		// second tap toggles playback.
		if (revealControls()) return
		controller.onTogglePlay()
	}

	function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
		// Resume seeks are centralised in `useResumeApply`, which listens
		// for `loadedmetadata`/`durationchange`/`canplay` itself (mobile
		// browsers occasionally drop the React-synthesised event).
		const size = readNaturalSize(e.currentTarget)
		if (size !== undefined) setNatural(size)
	}

	function handleEmitDanmaku(d: DanmakuRecord) {
		danmakuRef.current?.emit(toEngineComment(d, settings.fontSizePx))
	}

	const fit = resolveVideoFit({ fitMode, natural, naturalSize })

	return (
		<div
			className={cn(
				"relative flex h-full w-full flex-col overflow-hidden bg-black",
				className,
			)}
		>
			<EnhancedVideoPlayer.Container
				ref={(el) => {
					setPortalContainer(el ?? undefined)
				}}
				className={cn(
					// `flex-1 min-h-0` lets the container fill the column without
					// fighting the send-bar row below it. An explicit `h-full`
					// would force this row to claim the full parent height and
					// push the send bar past `overflow-hidden`, which on mobile
					// manifests as a thin gap between video and input as the
					// browser resolves the contradictory sizes.
					"group/player relative flex w-full flex-1 min-h-0 overflow-hidden bg-black items-center justify-center",
					// Mobile browsers fire `:focus-visible` on tap (the player
					// root is `tabindex=0` so it can capture keyboard shortcuts),
					// which paints a stray outline ring across the video.
					// Suppress it — the controls inside keep their own rings.
					"focus-visible:outline-hidden",
				)}
			>
				<Video
					ref={videoRef}
					src={src}
					autoPlay={autoplay ?? autoplayPrefValue}
					loop={loop}
					playsInline
					preload={preload ?? "metadata"}
					crossOrigin="anonymous"
					className={fit.className}
					style={fit.style}
					onClick={handleVideoClick}
					onLoadedMetadata={handleLoadedMetadata}
				/>
				<div
					ref={stageRef}
					className="pointer-events-none absolute inset-0"
					style={{ opacity: settings.enabled ? settings.opacity : 0 }}
				/>
				<PlayerPortalContainerContext.Provider value={portalContainer}>
					{controls === "none" ? undefined : (
						<PlayerControls
							mode={controls === "seek-only" ? "seek-only" : "full"}
							playback={{
								paused,
								currentMs,
								durationMs,
								volume: playback.volume,
								muted: playback.muted,
								rate: playback.rate,
								fullscreen: playback.fullscreen,
								scrubbing: controller.scrubbing,
							}}
							showControls={showControls}
							engine={engine}
							fitMode={fitMode}
							autoplay={autoplayPrefValue}
							lastResumedAt={lastResumedAt}
							resolveFrameUrl={api.resolveFrameUrl}
							filename={filename}
							actions={{
								onTogglePlay: controller.onTogglePlay,
								onSeek: controller.onSeek,
								onSeekCommit: controller.onSeekCommit,
								onVolumeChange: controller.onVolumeChange,
								onToggleMute: controller.onToggleMute,
								onRateChange: controller.onRateChange,
								onApplyRate: controller.onRateChange,
								onScreenshot: controller.onScreenshot,
								onTogglePip: controller.onTogglePip,
								onToggleFullscreen: controller.onToggleFullscreen,
								onEngineChange,
								onFitModeChange: setFitMode,
								onAutoplayChange: handleAutoplayChange,
							}}
						/>
					)}
				</PlayerPortalContainerContext.Provider>
			</EnhancedVideoPlayer.Container>
			{hideSendBar ? undefined : (
				<DanmakuSendBar
					filename={filename}
					getCurrentMs={() => currentMs}
					onEmit={handleEmitDanmaku}
					settings={settings}
					onSettingsChange={setSettings}
				/>
			)}
		</div>
	)
}
