import { Play } from "@hoardodile/ui/icons/registry"
import type {
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { apiPaths } from "@/lib/paths"
import {
	activatePlayback,
	ensureVisibilityListener,
	ownsPlayback,
	stopActiveMediaPreview,
} from "./mediaPlayback"

export type ResVideoHoverProps = {
	readonly resId: string
	readonly resName: string
	/**
	 * Called when the user requests the full preview dialog - on desktop
	 * this is a click on the centered button while playing; on touch it is
	 * a tap on the thumbnail outside the centered play button.
	 */
	readonly onZoomRequest: () => void
}

/**
 * Hover-to-play (desktop) / tap-to-play (touch) video overlay used inside a
 * {@link ResCard} thumbnail.
 *
 * Responsibilities:
 * - Mounts a muted `<video>` and toggles its visibility on hover/tap.
 * - Renders the centered play button (idle) / stop affordance (playing).
 * - Renders a thin progress bar at the bottom of the thumbnail while playing.
 * - Handles the play()/pause() race that can otherwise raise AbortError.
 * - Coordinates with siblings (video and audio alike) through
 *   `mediaPlayback` so only one card plays at a time.
 *
 * Click semantics while playing differ by input modality:
 *   - mouse: click anywhere on the centered button opens the preview dialog
 *     (hover already handles play/pause).
 *   - touch: tap on the centered button stops playback; tap elsewhere on
 *     the thumbnail opens the preview dialog.
 */
export function ResVideoHover(props: ResVideoHoverProps) {
	const { resId, resName, onZoomRequest } = props
	const { t } = useTranslation()
	const videoRef = useRef<HTMLVideoElement>(null)
	// Captured at pointerdown so the synthesized click handler can branch on
	// modality. React's MouseEvent does not expose `pointerType` directly.
	const lastPointerTypeRef = useRef<string>("mouse")
	// Set by activatePlayback so handlePointerLeave can detect a stale
	// pointerleave that arrived after another card already took over.
	const generationRef = useRef(0)
	const [isPlaying, setIsPlaying] = useState(false)
	const [progress, setProgress] = useState(0)

	// Stable wrapper around the latest stopVideo so the coordinator can hold
	// onto a single callback identity across renders.
	const stopVideoRef = useRef<() => void>(noop)
	const stableStopRef = useRef<(() => void) | undefined>(undefined)
	if (stableStopRef.current === undefined) {
		stableStopRef.current = () => stopVideoRef.current()
	}

	useEffect(() => {
		ensureVisibilityListener()
		return () => {
			stopActiveMediaPreview()
		}
	}, [])

	function startVideo() {
		const video = videoRef.current
		if (video === null) return
		video.currentTime = 0
		setProgress(0)
		const stop = stableStopRef.current
		if (stop !== undefined) generationRef.current = activatePlayback(stop)
		video.play().catch(() => {
			// Absorb the AbortError that fires when pause() races with play()
		})
		setIsPlaying(true)
	}

	function stopVideo() {
		const video = videoRef.current
		if (video === null) return
		setIsPlaying(false)
		// Pause immediately — don't wait for the pending play() promise, which
		// may not resolve promptly on mobile (or at all if the network stalls).
		// Any AbortError from the play()/pause() race is already absorbed by
		// the .catch() in startVideo().
		video.pause()
		// Reset network state to cancel the in-progress HTTP fetch and free
		// the browser connection for other requests.
		video.load()
	}

	stopVideoRef.current = stopVideo

	function handlePointerDown(e: ReactPointerEvent) {
		lastPointerTypeRef.current = e.pointerType
	}

	// Desktop hover-to-play. Touch devices never fire pointerenter/leave so
	// these become no-ops there.
	function handlePointerEnter(e: ReactPointerEvent) {
		if (e.pointerType !== "mouse") return
		startVideo()
	}

	function handlePointerLeave(e: ReactPointerEvent) {
		if (e.pointerType !== "mouse") return
		// Guard against a stale pointerleave that fires after another card
		// has already taken over active playback (rapid hover between cards).
		if (!ownsPlayback(generationRef.current)) return
		stopActiveMediaPreview()
	}

	function handleButtonClick(e: ReactMouseEvent) {
		// Block the surrounding <Link>/card so the click never navigates away.
		e.preventDefault()
		e.stopPropagation()
		const isMouse = lastPointerTypeRef.current === "mouse"
		if (isPlaying) {
			if (isMouse) onZoomRequest()
			else stopVideo()
			return
		}
		startVideo()
	}

	function handleOverlayClick(e: ReactMouseEvent) {
		e.preventDefault()
		e.stopPropagation()
		onZoomRequest()
	}

	function handleTimeUpdate() {
		const video = videoRef.current
		if (video === null) return
		const duration = video.duration
		if (!Number.isFinite(duration) || duration <= 0) return
		setProgress(video.currentTime / duration)
	}

	return (
		<>
			<video
				ref={videoRef}
				src={`${apiPaths.resources.cover(resId)}?size=original&format=video`}
				muted
				playsInline
				preload="none"
				onTimeUpdate={handleTimeUpdate}
				className={`absolute inset-0 w-full h-full object-contain rounded-xl transition-opacity duration-200 ${isPlaying ? "opacity-100" : "opacity-0"}`}
			/>

			{/* Touch-only overlay covering the thumbnail while playing.
			    Tapping anywhere outside the centered button opens the preview
			    dialog. Hidden on devices that support hover (desktop) so it
			    never intercepts mouse clicks meant for the surrounding card. */}
			{isPlaying ? (
				<button
					type="button"
					aria-label={t("resources.video.previewAria", { name: resName })}
					onClick={handleOverlayClick}
					className="pointer-events-auto absolute inset-0 z-10 hidden cursor-zoom-in [@media(hover:none)]:block"
					data-testid={`resource-video-overlay-${resId}`}
				/>
			) : null}

			{/* Centered button.
			    - Idle: visible play icon at 80% opacity, brighter on hover.
			    - Playing on desktop: fully transparent but still hit-testable
			      so a click opens the preview (hover keeps it playing).
			    - Playing on touch: fully transparent; tap stops playback. */}
			<button
				type="button"
				aria-label={
					isPlaying
						? t("resources.video.stopAria", { name: resName })
						: t("resources.video.playAria", { name: resName })
				}
				data-testid={`resource-video-play-${resId}`}
				onPointerDown={handlePointerDown}
				onPointerEnter={handlePointerEnter}
				onPointerLeave={handlePointerLeave}
				onClick={handleButtonClick}
				className={`pointer-events-auto absolute left-1/2 top-1/2 z-20 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white transition-opacity duration-200 bg-black/60 ${isPlaying ? "opacity-0" : "opacity-80 hover:opacity-100"}`}
			>
				<Play className="h-6 w-6" fill="currentColor" />
			</button>

			{/* Progress bar - only while playing. Thin track at the bottom of
			    the thumbnail; fill width tracks `currentTime / duration`. */}
			{isPlaying ? (
				<div
					className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-black/40"
					data-testid={`resource-video-progress-${resId}`}
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

function noop(): void {}
