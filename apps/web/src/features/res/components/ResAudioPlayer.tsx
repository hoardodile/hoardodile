import { MusicNotes, Pause, Play } from "@hoardodile/ui/icons/registry"
import type {
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
} from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { formatClockDuration } from "@/lib/formatDuration"
import { apiPaths } from "@/lib/paths"
import {
	activatePlayback,
	ensureVisibilityListener,
	stopActiveMediaPreview,
} from "./mediaPlayback"

/**
 * Height of the resident audio tile, on the 4px grid. Audio has no
 * intrinsic geometry, so the tile picks a deliberate short rectangle —
 * it reads as a player, not as a cropped cover, and keeps audio cards
 * visually distinct from the square-ish image cards around them.
 */
export const AUDIO_TILE_HEIGHT = 120

/** Keyboard seek step on the scrub track. */
const SEEK_STEP_MS = 5_000

export type ResAudioPlayerProps = {
	readonly resId: string
	readonly resName: string
	/**
	 * - `"overlay"`: the resource has artwork; the cover carries the tile
	 *   and the controls only surface on hover, mirroring the restraint of
	 *   the video hover layer.
	 * - `"tile"`: no artwork — the player *is* the tile, resident and
	 *   always legible.
	 */
	readonly variant: "overlay" | "tile"
}

/**
 * In-app audio player for a resource card thumbnail.
 *
 * Owned by the web app, not by a content plugin: an audio resource has
 * nothing to render as a cover, so the card provides the affordance
 * itself. Detail and preview surfaces still hand rendering to the
 * owning plugin's iframe.
 *
 * Streams the resource's cover source through the audio passthrough
 * endpoint and coordinates with the card's video hover through
 * `mediaPlayback`, so only one card ever plays at a time.
 */
export function ResAudioPlayer(props: ResAudioPlayerProps) {
	const { resId, resName, variant } = props
	const { t } = useTranslation()
	const audioRef = useRef<HTMLAudioElement>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [positionMs, setPositionMs] = useState(0)
	const [durationMs, setDurationMs] = useState<number | undefined>(undefined)

	// Stable wrapper around the latest stop so the coordinator can hold
	// one callback identity across renders.
	const stopRef = useRef<() => void>(noop)
	const stableStopRef = useRef<(() => void) | undefined>(undefined)
	if (stableStopRef.current === undefined) {
		stableStopRef.current = () => stopRef.current()
	}

	useEffect(() => {
		ensureVisibilityListener()
		return () => {
			stopActiveMediaPreview()
		}
	}, [])

	function play() {
		const audio = audioRef.current
		if (audio === null) return
		const stop = stableStopRef.current
		if (stop !== undefined) activatePlayback(stop)
		// Absorb the AbortError raised when pause() races with play().
		audio.play().catch(() => {})
		setIsPlaying(true)
	}

	function pause() {
		const audio = audioRef.current
		if (audio === null) return
		setIsPlaying(false)
		audio.pause()
	}

	stopRef.current = pause

	function handleToggle(e: ReactMouseEvent) {
		// Block the surrounding <Link>/card so the click never navigates.
		e.preventDefault()
		e.stopPropagation()
		if (isPlaying) pause()
		else play()
	}

	function handleLoadedMetadata() {
		const audio = audioRef.current
		if (audio === null) return
		const seconds = audio.duration
		if (!Number.isFinite(seconds) || seconds <= 0) return
		setDurationMs(Math.round(seconds * 1000))
	}

	function handleTimeUpdate() {
		const audio = audioRef.current
		if (audio === null) return
		setPositionMs(Math.round(audio.currentTime * 1000))
	}

	function handleEnded() {
		setIsPlaying(false)
		setPositionMs(0)
	}

	function seekTo(ratio: number) {
		const audio = audioRef.current
		if (audio === null) return
		const seconds = audio.duration
		if (!Number.isFinite(seconds) || seconds <= 0) return
		const clamped = Math.min(1, Math.max(0, ratio))
		audio.currentTime = clamped * seconds
		setPositionMs(Math.round(clamped * seconds * 1000))
	}

	function handleSeek(e: ReactMouseEvent<HTMLDivElement>) {
		e.preventDefault()
		e.stopPropagation()
		const rect = e.currentTarget.getBoundingClientRect()
		if (rect.width <= 0) return
		seekTo((e.clientX - rect.left) / rect.width)
	}

	function nudge(deltaMs: number) {
		const audio = audioRef.current
		if (audio === null) return
		const seconds = audio.duration
		if (!Number.isFinite(seconds) || seconds <= 0) return
		seekTo((audio.currentTime * 1000 + deltaMs) / (seconds * 1000))
	}

	function handleSeekKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
		const step = e.key === "ArrowLeft" ? -SEEK_STEP_MS : SEEK_STEP_MS
		if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			e.preventDefault()
			e.stopPropagation()
			nudge(step)
			return
		}
		if (e.key === "Home" || e.key === "End") {
			e.preventDefault()
			e.stopPropagation()
			seekTo(e.key === "Home" ? 0 : 1)
		}
	}

	const progress =
		durationMs !== undefined && durationMs > 0
			? Math.min(1, positionMs / durationMs)
			: 0

	const media = (
		// biome-ignore lint/a11y/useMediaCaption: archived audio files carry no caption tracks
		<audio
			ref={audioRef}
			src={`${apiPaths.resources.cover(resId)}?size=original&format=audio`}
			// Metadata only: the tile shows a real duration the moment it
			// mounts, and the cover endpoint serves byte ranges, so this
			// costs a header read rather than the whole track. (The video
			// hover can afford `none` because it has a poster frame to show;
			// a player with no duration reads as broken.)
			preload="metadata"
			onLoadedMetadata={handleLoadedMetadata}
			onTimeUpdate={handleTimeUpdate}
			onEnded={handleEnded}
			data-testid={`resource-audio-${resId}`}
		/>
	)

	const toggleLabel = isPlaying
		? t("resources.audio.pauseAria", { name: resName })
		: t("resources.audio.playAria", { name: resName })

	if (variant === "overlay") {
		return (
			<>
				{media}
				{/* Centered toggle, revealed on hover like the cover actions;
				    while hidden it ignores pointer events so the cover link
				    underneath keeps receiving clicks. */}
				<button
					type="button"
					aria-label={toggleLabel}
					onClick={handleToggle}
					data-testid={`resource-audio-toggle-${resId}`}
					className={`pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-opacity duration-(--duration-2) group-hover:pointer-events-auto group-hover:opacity-100 ${
						isPlaying
							? "pointer-events-auto opacity-100"
							: "opacity-0 hover:opacity-100"
					}`}
				>
					{isPlaying ? (
						<Pause className="h-6 w-6" fill="currentColor" />
					) : (
						<Play className="h-6 w-6" fill="currentColor" />
					)}
				</button>
				{isPlaying ? (
					<div
						className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-0.5 bg-black/40"
						data-testid={`resource-audio-progress-${resId}`}
					>
						<div
							className="h-full bg-white/90 transition-[width] duration-100 ease-linear"
							style={{ width: `${progress * 100}%` }}
						/>
					</div>
				) : null}
			</>
		)
	}

	return (
		<div
			className="flex h-full w-full items-center gap-3 rounded-xl bg-muted px-4"
			data-testid={`resource-audio-tile-${resId}`}
		>
			{media}
			<button
				type="button"
				aria-label={toggleLabel}
				onClick={handleToggle}
				data-testid={`resource-audio-toggle-${resId}`}
				className="z-20 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-card text-secondary-foreground shadow-card transition-colors duration-(--duration-1) hover:text-foreground"
			>
				{isPlaying ? (
					<Pause className="size-5" fill="currentColor" />
				) : (
					<Play className="size-5" fill="currentColor" />
				)}
			</button>
			<div className="z-20 flex min-w-0 flex-1 flex-col gap-2">
				{/* Name left, elapsed/total right — the card footer anatomy:
				    metadata stays quiet and right-aligned. */}
				<div className="flex min-w-0 items-baseline justify-between gap-2">
					<span className="flex min-w-0 items-center gap-1.5 text-xs text-secondary-foreground">
						<MusicNotes className="size-3.5 shrink-0" aria-hidden />
						<span className="truncate">{resName}</span>
					</span>
					<span className="shrink-0 text-tiny text-muted-foreground tabular-nums">
						{formatClockDuration(positionMs)}
						{durationMs === undefined
							? null
							: ` / ${formatClockDuration(durationMs)}`}
					</span>
				</div>
				{/* Scrub track. Click or arrow keys — a drag handle would need
				    a pointer capture layer that competes with the card's own
				    click targets. */}
				<div
					role="slider"
					tabIndex={0}
					aria-label={t("resources.audio.seekAria", { name: resName })}
					aria-valuemin={0}
					aria-valuemax={durationMs ?? 0}
					aria-valuenow={positionMs}
					onClick={handleSeek}
					onKeyDown={handleSeekKeyDown}
					data-testid={`resource-audio-seek-${resId}`}
					className="h-1 w-full cursor-pointer rounded-full bg-border outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
				>
					{/* Fill from the foreground ramp, matching the system's
					    progress track — accent stays reserved for meaning
					    the user assigned. */}
					<div
						className="h-full rounded-full bg-foreground/70 transition-[width] duration-100 ease-linear"
						style={{ width: `${progress * 100}%` }}
					/>
				</div>
			</div>
		</div>
	)
}

function noop(): void {}
