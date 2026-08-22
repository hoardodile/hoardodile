import { Slider } from "@hoardodile/ui/components/slider"
import { useBelowMd } from "@hoardodile/ui/hooks/use-mobile"
import { cn } from "@hoardodile/ui/lib/utils"
import { CameraIcon as Camera } from "@solar-icons/react/linear/camera"
import { MaximizeIcon as Maximize } from "@solar-icons/react/linear/maximize"
import { MinimizeIcon as Minimize } from "@solar-icons/react/linear/minimize"
import { PauseIcon as Pause } from "@solar-icons/react/linear/pause"
import { PlayIcon as Play } from "@solar-icons/react/linear/play"
import { SquareBottomUpIcon as SquareBottomUp } from "@solar-icons/react/linear/square-bottom-up"
import { useEffect, useState } from "react"
import { useTranslation } from "../i18n"
import { DisplaySettingsPopover } from "./DisplaySettingsPopover"
import { formatTime } from "./helpers"
import { IconButton } from "./IconButton"
import { MoreControlsPopover } from "./MoreControlsPopover"
import { RateSelect } from "./RateSelect"
import {
	type FitMode,
	type PlayerControlsActions,
	type PlayerEngine,
	type PlayerPlaybackState,
	RESUME_HINT_DURATION_MS,
} from "./types"
import { type ScrubPreview, useScrubPreview } from "./useScrubPreview"
import { VolumeControl } from "./VolumeControl"

type ControlsProps = {
	/**
	 * `full`      — the standard control bar (default).
	 * `seek-only` — just a thin progress slider pinned to the bottom
	 *               edge so the user can scrub without the rest of the
	 *               chrome competing for the viewport.
	 */
	readonly mode?: "full" | "seek-only"
	readonly playback: PlayerPlaybackState
	readonly showControls?: boolean
	readonly engine: PlayerEngine
	readonly fitMode: FitMode
	readonly autoplay: boolean
	/**
	 * Wall-clock timestamp at which the resume hook successfully
	 * jumped the video back to its last position. Triggers a brief
	 * top-left hint so the user understands why the time changed.
	 * `undefined` keeps the badge hidden.
	 */
	readonly lastResumedAt: number | undefined
	/**
	 * Builds a server-rendered frame-thumbnail URL for the current file.
	 * Supplied by the host (via the plugin SDK) so the control bar never
	 * needs to know the resource id or the API path layout. Pass
	 * `undefined` to disable the hover-preview affordance.
	 */
	readonly resolveFrameUrl?: (filename: string, timeMs: number) => string
	readonly filename?: string
	readonly actions: PlayerControlsActions
}

type ExclusivePopover = "display" | "rate" | "more" | undefined

/**
 * The seek-track class soup per variant, kept as one source of truth
 * so the two bars cannot drift apart visually.
 */
const SLIDER_CLASSES = {
	thin: `cursor-pointer
		**:data-[slot=slider-track]:h-0.5
		**:data-[slot=slider-track]:bg-white/30
		**:data-[slot=slider-track]:transition-[height]
		**:data-[slot=slider-track]:duration-150
		hover:**:data-[slot=slider-track]:h-1
		data-[scrubbing=true]:**:data-[slot=slider-track]:h-1
		**:data-[slot=slider-range]:bg-primary
		**:data-[slot=slider-thumb]:size-3
		**:data-[slot=slider-thumb]:border-0
		**:data-[slot=slider-thumb]:bg-primary
		**:data-[slot=slider-thumb]:opacity-0
		**:data-[slot=slider-thumb]:transition-opacity
		data-[scrubbing=true]:**:data-[slot=slider-thumb]:opacity-100`,
	full: `cursor-pointer
		**:data-[slot=slider-track]:h-1
		**:data-[slot=slider-track]:bg-white/25
		**:data-[slot=slider-track]:transition-[height]
		**:data-[slot=slider-track]:duration-150
		hover:**:data-[slot=slider-track]:h-1.5
		data-[scrubbing=true]:**:data-[slot=slider-track]:h-1.5
		**:data-[slot=slider-range]:bg-primary
		**:data-[slot=slider-thumb]:size-3.5
		**:data-[slot=slider-thumb]:border-0
		**:data-[slot=slider-thumb]:bg-primary
		**:data-[slot=slider-thumb]:shadow-[0_0_0_4px_rgba(255,255,255,0.18)]
		**:data-[slot=slider-thumb]:opacity-0
		**:data-[slot=slider-thumb]:transition-opacity
		data-[scrubbing=true]:**:data-[slot=slider-thumb]:opacity-100`,
} as const

export function PlayerControls(props: ControlsProps) {
	const {
		mode = "full",
		playback,
		showControls,
		engine,
		fitMode,
		autoplay,
		lastResumedAt,
		resolveFrameUrl,
		filename,
		actions,
	} = props
	const { t } = useTranslation()
	const isBelowMd = useBelowMd()

	const scrub = useScrubPreview({
		durationMs: playback.durationMs,
		resolveFrameUrl,
		filename,
	})

	// Mutually-exclusive popover slot for display/rate/more. Each Radix
	// Select/Popover only closes itself on outside-click; without this
	// guard, clicking a sibling trigger races with the close.
	const [openPopover, setOpenPopover] = useState<ExclusivePopover>(undefined)
	function makeOpenChange(slot: Exclude<ExclusivePopover, undefined>) {
		return function handleOpenChange(open: boolean) {
			setOpenPopover(open ? slot : (cur) => (cur === slot ? undefined : cur))
		}
	}

	// Independent popovers (volume, danmaku settings) bump this counter
	// so the control bar stays visible while the user interacts with
	// their portal-rendered popups.
	const [openCount, setOpenCount] = useState(0)
	function handleAuxOpenChange(open: boolean) {
		setOpenCount((n) => (open ? n + 1 : Math.max(0, n - 1)))
	}
	const interacting = openPopover !== undefined || openCount > 0

	if (mode === "seek-only") {
		return (
			<div
				className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 px-3 pb-2"
				data-scrubbing={playback.scrubbing ? "true" : "false"}
			>
				<ScrubSlider
					variant="thin"
					currentMs={playback.currentMs}
					durationMs={playback.durationMs}
					scrubbing={playback.scrubbing}
					preview={scrub}
					onSeek={actions.onSeek}
					onSeekCommit={actions.onSeekCommit}
				/>
			</div>
		)
	}
	return (
		<>
			<ResumeHintBadge
				lastResumedAt={lastResumedAt}
				currentMs={playback.currentMs}
			/>
			{playback.paused ? (
				<PausedPlayButton onTogglePlay={actions.onTogglePlay} />
			) : null}
			<div
				className={cn(
					"pointer-events-none absolute inset-x-0 -bottom-0.5 flex flex-col gap-2 bg-linear-to-t from-black/90 via-black/55 to-transparent pt-10 text-white",
					"opacity-0 transition-opacity duration-200 group-hover/player:opacity-100 focus-within:opacity-100 data-[paused=true]:opacity-100 data-[scrubbing=true]:opacity-100 data-[interacting=true]:opacity-100",
					isBelowMd ? "data-[controls-visible=true]:opacity-100" : "",
					"[&_button]:pointer-events-auto **:[[role=slider]]:pointer-events-auto **:data-[slot=slider]:pointer-events-auto **:data-[slot=select-trigger]:pointer-events-auto",
				)}
				data-paused={playback.paused ? "true" : "false"}
				data-scrubbing={playback.scrubbing ? "true" : "false"}
				data-interacting={interacting ? "true" : "false"}
				data-controls-visible={showControls ? "true" : "false"}
			>
				<ScrubSlider
					variant="full"
					currentMs={playback.currentMs}
					durationMs={playback.durationMs}
					scrubbing={playback.scrubbing}
					preview={scrub}
					onSeek={actions.onSeek}
					onSeekCommit={actions.onSeekCommit}
				/>
				<div className="flex items-center gap-1 pb-2 px-2">
					<IconButton
						ariaLabel={playback.paused ? t("player.play") : t("player.pause")}
						onClick={actions.onTogglePlay}
						size="lg"
					>
						{playback.paused ? (
							<Play className="size-5 fill-current" />
						) : (
							<Pause className="size-5 fill-current" />
						)}
					</IconButton>
					<VolumeControl
						volume={playback.volume}
						muted={playback.muted}
						onToggleMute={actions.onToggleMute}
						onVolumeChange={actions.onVolumeChange}
						onOpenChange={handleAuxOpenChange}
					/>
					<span className="ml-1 select-none font-mono text-xs tabular-nums tracking-wide text-white/85">
						<span className="text-white">{formatTime(playback.currentMs)}</span>
						<span className="px-1 text-white/40">/</span>
						<span>{formatTime(playback.durationMs)}</span>
					</span>
					<div className="ml-auto flex items-center gap-1">
						{/* Inline on >=sm. Collapsed into the "more" popover on
						    mobile where the bar would otherwise overflow. */}
						<div className="hidden items-center gap-1 sm:flex">
							<DisplaySettingsPopover
								engine={engine}
								fitMode={fitMode}
								autoplay={autoplay}
								onEngineChange={actions.onEngineChange}
								onFitModeChange={actions.onFitModeChange}
								onAutoplayChange={actions.onAutoplayChange}
								open={openPopover === "display"}
								onOpenChange={makeOpenChange("display")}
							/>
							<RateSelect
								rate={playback.rate}
								onChange={actions.onRateChange}
								onApply={actions.onApplyRate}
								open={openPopover === "rate"}
								onOpenChange={makeOpenChange("rate")}
							/>
							<IconButton
								ariaLabel={t("player.screenshot")}
								onClick={actions.onScreenshot}
							>
								<Camera className="size-4.5" />
							</IconButton>
							<IconButton
								ariaLabel={t("player.pip")}
								onClick={actions.onTogglePip}
							>
								<SquareBottomUp className="size-4.5" />
							</IconButton>
						</div>
						<div className="flex items-center gap-1 sm:hidden">
							<MoreControlsPopover
								rate={playback.rate}
								engine={engine}
								fitMode={fitMode}
								autoplay={autoplay}
								onRateChange={actions.onRateChange}
								onApplyRate={actions.onApplyRate}
								onScreenshot={actions.onScreenshot}
								onTogglePip={actions.onTogglePip}
								onEngineChange={actions.onEngineChange}
								onFitModeChange={actions.onFitModeChange}
								onAutoplayChange={actions.onAutoplayChange}
								open={openPopover === "more"}
								onOpenChange={makeOpenChange("more")}
							/>
						</div>
						<IconButton
							ariaLabel={
								playback.fullscreen
									? t("player.exitFullscreen")
									: t("player.fullscreen")
							}
							onClick={actions.onToggleFullscreen}
						>
							{playback.fullscreen ? (
								<Minimize className="size-4.5" />
							) : (
								<Maximize className="size-4.5" />
							)}
						</IconButton>
					</div>
				</div>
			</div>
		</>
	)
}

/**
 * The shared seek track + frame hover preview. Both control-bar
 * variants render exactly this unit, differing only in the slider
 * styling.
 */
function ScrubSlider(props: {
	readonly variant: "thin" | "full"
	readonly currentMs: number
	readonly durationMs: number
	readonly scrubbing: boolean
	readonly preview: ScrubPreview
	readonly onSeek: PlayerControlsActions["onSeek"]
	readonly onSeekCommit: PlayerControlsActions["onSeekCommit"]
}) {
	const {
		variant,
		currentMs,
		durationMs,
		scrubbing,
		preview,
		onSeek,
		onSeekCommit,
	} = props
	const { t } = useTranslation()
	return (
		<div
			className="relative pointer-events-auto"
			onPointerMove={(e) => {
				if (e.pointerType !== "mouse") return
				preview.onPointerMove(
					e.currentTarget.getBoundingClientRect(),
					e.clientX,
				)
			}}
			onPointerLeave={preview.hide}
		>
			<div
				className={cn(
					"pointer-events-none absolute bottom-full mb-2 flex -translate-x-1/2 flex-col items-center gap-1 transition-opacity duration-100",
					preview.visible ? "opacity-100" : "opacity-0",
				)}
				style={{ left: preview.x }}
			>
				{preview.imageUrl !== undefined && (
					<img
						src={preview.imageUrl}
						alt=""
						className="block h-20 w-36 rounded bg-black/80 object-contain"
					/>
				)}
				<span className="rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
					{formatTime(preview.timeMs)}
				</span>
			</div>
			<Slider
				value={[currentMs]}
				min={0}
				max={Math.max(durationMs, 1)}
				step={100}
				onValueChange={onSeek}
				onValueCommitted={onSeekCommit}
				aria-label={t("player.progress")}
				data-scrubbing={scrubbing ? "true" : "false"}
				className={SLIDER_CLASSES[variant]}
			/>
		</div>
	)
}

/** Brief top-left badge explaining a resume seek ("Resume in 01:23"). */
function ResumeHintBadge(props: {
	readonly lastResumedAt: number | undefined
	readonly currentMs: number
}) {
	const { lastResumedAt, currentMs } = props
	const { t } = useTranslation()
	const [visible, setVisible] = useState(false)
	useEffect(() => {
		if (lastResumedAt === undefined) return
		setVisible(true)
		const handle = window.setTimeout(() => {
			setVisible(false)
		}, RESUME_HINT_DURATION_MS)
		return () => {
			window.clearTimeout(handle)
		}
	}, [lastResumedAt])
	if (!visible) return null
	return (
		<div
			data-testid="player-resume-hint"
			className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs text-white/90 backdrop-blur-sm"
		>
			{t("player.resume", { time: formatTime(currentMs) })}
		</div>
	)
}

/** Floating play button shown while paused, above the control bar. */
function PausedPlayButton(props: { readonly onTogglePlay: () => void }) {
	const { t } = useTranslation()
	return (
		<button
			type="button"
			aria-label={t("player.play")}
			onClick={props.onTogglePlay}
			className="pointer-events-auto absolute right-4 bottom-16 z-10 flex size-12 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition hover:bg-black/55 hover:text-white"
		>
			<Play className="size-6 translate-x-0.5 fill-current" />
		</button>
	)
}
