import type { VideoPlayerStore } from "@videojs/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePluginAPI } from "../hooks"
import { noopReject } from "./helpers"
import { VOLUME_PREF_KEY } from "./types"

/**
 * Playback actions for the enhanced player: everything that translates
 * a control-bar gesture into a store call. Extracted from the component
 * so the control surface stays declarative and the interaction rules —
 * scrub pauses and restores, a zero-volume drag implies mute, a screen
 * grab is a pure capture plus a download — are readable in one place.
 */

export type PlayerScrubState = {
	readonly scrubbing: boolean
	readonly onSeek: (values: number | readonly number[]) => void
	readonly onSeekCommit: () => void
}

export type PlayerController = PlayerScrubState & {
	readonly onTogglePlay: () => void
	readonly onVolumeChange: (values: number | readonly number[]) => void
	readonly onToggleMute: () => void
	readonly onRateChange: (rate: number) => void
	readonly onTogglePip: () => void
	readonly onToggleFullscreen: () => void
	readonly onScreenshot: () => void
}

export function usePlayerController(opts: {
	readonly store: VideoPlayerStore
	readonly videoRef: React.RefObject<HTMLVideoElement | null>
	readonly paused: boolean
	readonly muted: boolean
	/** Called before a user-driven play/pause, to reset the auto-hide timer. */
	readonly onInteraction?: () => void
}): PlayerController {
	const { store, videoRef, paused, muted, onInteraction } = opts
	const api = usePluginAPI()
	const [scrubbing, setScrubbing] = useState(false)
	const scrubResumeRef = useRef(false)

	// `api` and the resource name are read inside callbacks that must not
	// be recreated on every render; a ref keeps them current.
	const apiRef = useRef(api)
	apiRef.current = api

	const onTogglePlay = useCallback(() => {
		onInteraction?.()
		if (paused) store.play().catch(noopReject)
		else store.pause()
	}, [onInteraction, paused, store])

	const onSeek = useCallback(
		(values: number | readonly number[]) => {
			const next = typeof values === "number" ? values : values[0]
			if (next === undefined) return
			// The first tick enters scrub mode and pauses for frame-accurate
			// previews; the prior paused state is restored on commit.
			if (!scrubbing) {
				scrubResumeRef.current = !paused
				store.pause()
				setScrubbing(true)
			}
			store.seek(next / 1000).catch(noopReject)
		},
		[paused, scrubbing, store],
	)

	const onSeekCommit = useCallback(() => {
		if (!scrubbing) return
		setScrubbing(false)
		if (scrubResumeRef.current) {
			store.play().catch(noopReject)
			scrubResumeRef.current = false
		}
	}, [scrubbing, store])

	const onVolumeChange = useCallback(
		(values: number | readonly number[]) => {
			const next = (typeof values === "number" ? values : values[0]) ?? 0
			// Drop writes that race the media target (slider rendered before
			// `loadedmetadata`); the store throws `StoreError: NO_TARGET`.
			try {
				store.setVolume(next)
				if (next === 0 && !muted) store.toggleMuted()
				else if (next > 0 && muted) store.toggleMuted()
			} catch {
				return
			}
			apiRef.current.setPref(VOLUME_PREF_KEY, String(next))
		},
		[muted, store],
	)

	const onToggleMute = useCallback(() => {
		store.toggleMuted()
	}, [store])

	const onRateChange = useCallback(
		(rate: number) => {
			store.setPlaybackRate(rate)
		},
		[store],
	)

	const onTogglePip = useCallback(() => {
		store.togglePictureInPicture().catch(noopReject)
	}, [store])

	const onToggleFullscreen = useCallback(() => {
		store.toggleFullscreen().catch(noopReject)
	}, [store])

	const onScreenshot = useCallback(() => {
		const video = videoRef.current
		if (video === null) return
		const filename = `${apiRef.current.resource.name}-${Math.round(video.currentTime * 1000)}.png`
		captureVideoFrame(video, (blob) => {
			downloadBlob(blob, filename)
		})
	}, [videoRef])

	return {
		scrubbing,
		onTogglePlay,
		onSeek,
		onSeekCommit,
		onVolumeChange,
		onToggleMute,
		onRateChange,
		onTogglePip,
		onToggleFullscreen,
		onScreenshot,
	}
}

/**
 * Draw the current frame to a canvas and hand the caller a PNG blob.
 * A tainted canvas (cross-origin frame without CORS) throws on
 * `drawImage`; the grab is simply skipped.
 */
export function captureVideoFrame(
	video: HTMLVideoElement,
	onBlob: (blob: Blob) => void,
): void {
	if (video.videoWidth === 0) return
	const canvas = document.createElement("canvas")
	canvas.width = video.videoWidth
	canvas.height = video.videoHeight
	const ctx = canvas.getContext("2d")
	if (ctx === null) return
	try {
		ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
	} catch {
		return
	}
	canvas.toBlob((blob) => {
		if (blob !== null) onBlob(blob)
	}, "image/png")
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}

/**
 * Mobile control-bar auto-hide: the chrome fades after a few idle
 * seconds while playing, and comes back on tap or pause. Desktop keeps
 * the controls pinned, so the timer never starts there.
 */
export function useControlsAutoHide(opts: {
	readonly enabled: boolean
	readonly paused: boolean
	/** Resets the timer whenever this changes (e.g. the active file). */
	readonly resetKey: string
	readonly hideAfterMs?: number
}): {
	readonly showControls: boolean
	/** Reveal the controls and restart the timer; returns true if it was a reveal. */
	readonly revealControls: () => boolean
	readonly cancelAutoHide: () => void
} {
	const { enabled, paused, resetKey, hideAfterMs = 3000 } = opts
	const [showControls, setShowControls] = useState(true)
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	)

	const cancelAutoHide = useCallback(() => {
		if (timeoutRef.current !== undefined) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = undefined
		}
	}, [])

	const scheduleHide = useCallback(() => {
		cancelAutoHide()
		if (!enabled || paused) return
		timeoutRef.current = setTimeout(() => {
			setShowControls(false)
		}, hideAfterMs)
	}, [cancelAutoHide, enabled, hideAfterMs, paused])

	useEffect(() => {
		if (!enabled) return
		if (paused) {
			cancelAutoHide()
			setShowControls(true)
		} else {
			scheduleHide()
		}
	}, [cancelAutoHide, enabled, paused, scheduleHide])

	// Switching files (or unmounting) must not leave a timer pointed at
	// the surface that is going away.
	useEffect(() => {
		return cancelAutoHide
	}, [cancelAutoHide, resetKey])

	const revealControls = useCallback((): boolean => {
		if (!enabled || paused || showControls) return false
		setShowControls(true)
		scheduleHide()
		return true
	}, [enabled, paused, scheduleHide, showControls])

	return { showControls, revealControls, cancelAutoHide }
}
