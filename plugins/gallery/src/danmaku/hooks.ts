import type { Danmaku as DanmakuRecord } from "@hoardodile/sdk-web"
import { booleanCodec, numberCodec } from "@hoardodile/sdk-web"
import type { VideoPlayerStore } from "@videojs/react"
import type Danmaku from "danmaku"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePluginAPI } from "../hooks"
import { areaToHeight, noopReject, toEngineComment } from "./helpers"
import { resumeCacheKey, writeResume } from "./resume"
import {
	AUTOPLAY_PREF_KEY,
	type DanmakuSettings,
	ENGINE_PREF_KEY,
	FIT_MODE_PREF_KEY,
	type FitMode,
	type PlayerEngine,
	RESUME_MIN_REMAINING_MS,
	RESUME_THROTTLE_MS,
	VOLUME_PREF_KEY,
} from "./types"

type EngineDeps = {
	readonly stageRef: React.RefObject<HTMLDivElement | null>
	readonly videoRef: React.RefObject<HTMLVideoElement | null>
	readonly danmakuRef: React.MutableRefObject<Danmaku | undefined>
	readonly comments: readonly DanmakuRecord[] | undefined
	readonly settings: DanmakuSettings
}

export function useDanmakuEngine(deps: EngineDeps) {
	const { stageRef, videoRef, danmakuRef, comments, settings } = deps
	const fontSize = settings.fontSizePx
	const area = settings.area
	const initializedRef = useRef(false)
	const commentsReady = comments !== undefined

	useEffect(() => {
		if (initializedRef.current) return
		if (!commentsReady) return
		const stage = stageRef.current
		const video = videoRef.current
		if (stage === null || video === null) return
		initializedRef.current = true
		let cancelled = false
		let instance: Danmaku | undefined
		const initialComments = (comments ?? []).map((c) =>
			toEngineComment(c, fontSize),
		)
		import("danmaku")
			.then((mod) => {
				if (cancelled) return
				const Ctor = mod.default
				instance = new Ctor({
					container: stage,
					media: video,
					comments: initialComments,
					engine: "dom",
				})
				danmakuRef.current = instance
			})
			.catch(noopReject)
		return () => {
			cancelled = true
			instance?.destroy()
			danmakuRef.current = undefined
		}
	}, [commentsReady])

	useEffect(() => {
		const d = danmakuRef.current
		if (d === undefined) return
		d.resize()
	}, [danmakuRef, area])

	useEffect(() => {
		const stage = stageRef.current
		if (stage === null) return
		stage.style.height = areaToHeight(area)
	}, [stageRef, area])
}

type ResumePlaybackDeps = {
	readonly videoRef: React.RefObject<HTMLVideoElement | null>
	readonly filename: string
	readonly currentMs: number
	readonly durationMs: number
	readonly disabled?: boolean
}

export function useResumePlayback(deps: ResumePlaybackDeps) {
	const api = usePluginAPI()
	const { videoRef, filename, currentMs, durationMs, disabled = false } = deps
	const lastWriteRef = useRef(0)
	const apiRef = useRef(api)
	apiRef.current = api
	const latestRef = useRef({ filename, currentMs, durationMs })
	latestRef.current = { filename, currentMs, durationMs }
	useEffect(() => {
		if (disabled) return
		const v = videoRef.current
		if (v === null) return
		const now = Date.now()
		if (now - lastWriteRef.current < RESUME_THROTTLE_MS) return
		const durMs = durationMs > 0 ? durationMs : durationFromElement(v)
		if (durMs === 0) return
		const curMs = currentMs > 0 ? currentMs : Math.round(v.currentTime * 1000)
		writeResume(apiRef.current, {
			filename,
			currentMs: curMs,
			durationMs: durMs,
		})
		lastWriteRef.current = now
	}, [videoRef, filename, currentMs, durationMs, disabled])
	useEffect(function flushOnUnmountAndPagehide() {
		if (disabled) return
		function flush() {
			const snap = latestRef.current
			const v = videoRef.current
			const durMs =
				snap.durationMs > 0
					? snap.durationMs
					: v !== null
						? durationFromElement(v)
						: 0
			if (durMs === 0) return
			const curMs =
				snap.currentMs > 0
					? snap.currentMs
					: v !== null
						? Math.round(v.currentTime * 1000)
						: 0
			writeResume(apiRef.current, {
				filename: snap.filename,
				currentMs: curMs,
				durationMs: durMs,
			})
		}
		window.addEventListener("pagehide", flush)
		return () => {
			window.removeEventListener("pagehide", flush)
			flush()
		}
	}, [])
}

function durationFromElement(v: HTMLVideoElement): number {
	const d = v.duration
	return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0
}

type ResumeApplyDeps = {
	readonly videoRef: React.RefObject<HTMLVideoElement | null>
	readonly filename: string
	readonly disabled?: boolean
}

export function useResumeApply(deps: ResumeApplyDeps): {
	readonly lastResumedAt: number | undefined
} {
	const api = usePluginAPI()
	const { videoRef, filename, disabled = false } = deps
	// One-shot read: the per-resource cache is seeded into the iframe
	// context before mount, so the saved offset is available
	// synchronously. The player remounts per file (`key={src}`), so a
	// mount-time read always matches the current file.
	const [resumeMs] = useState(function readInitial() {
		const raw = api.getCache(resumeCacheKey(filename))
		const parsed = raw !== undefined ? Number(raw) : 0
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
	})
	const appliedRef = useRef(false)
	const [lastResumedAt, setLastResumedAt] = useState<number | undefined>(
		undefined,
	)
	useEffect(
		function applyResume() {
			if (disabled) return
			if (appliedRef.current) return
			const winningMs = resumeMs
			if (winningMs <= 0) {
				appliedRef.current = true
				return
			}
			const v = videoRef.current
			if (v === null) return
			function tryApply(): boolean {
				if (v === null) return false
				const total = v.duration
				if (!Number.isFinite(total) || total <= 0) return false
				appliedRef.current = true
				if (total * 1000 - winningMs < RESUME_MIN_REMAINING_MS) return true
				if (v.currentTime * 1000 < winningMs - 250) {
					v.currentTime = winningMs / 1000
					setLastResumedAt(Date.now())
				}
				return true
			}
			if (tryApply()) return
			function handler() {
				if (tryApply() && v !== null) {
					v.removeEventListener("loadedmetadata", handler)
					v.removeEventListener("durationchange", handler)
					v.removeEventListener("canplay", handler)
				}
			}
			v.addEventListener("loadedmetadata", handler)
			v.addEventListener("durationchange", handler)
			v.addEventListener("canplay", handler)
			return () => {
				v.removeEventListener("loadedmetadata", handler)
				v.removeEventListener("durationchange", handler)
				v.removeEventListener("canplay", handler)
			}
		},
		[resumeMs, videoRef, filename, disabled],
	)
	return { lastResumedAt }
}

type InitialVolumeDeps = {
	readonly store: VideoPlayerStore
	readonly duration: number
}

export function useInitialVolume(deps: InitialVolumeDeps) {
	const api = usePluginAPI()
	const { store, duration } = deps
	const [volume] = api.usePref<number>(VOLUME_PREF_KEY, 1, numberCodec())
	const appliedRef = useRef(false)
	useEffect(() => {
		if (appliedRef.current) return
		if (duration <= 0) return
		appliedRef.current = true
		const clamped = Math.min(1, Math.max(0, volume))
		try {
			store.setVolume(clamped)
		} catch {}
	}, [store, duration, volume])
}

export function useAutoplayPref(): {
	readonly autoplay: boolean
	readonly setAutoplay: (next: boolean) => void
} {
	const api = usePluginAPI()
	const [autoplay, setAutoplay] = api.usePref<boolean>(
		AUTOPLAY_PREF_KEY,
		false,
		booleanCodec(),
	)
	return { autoplay, setAutoplay }
}

/** Persisted player surface: `enhanced` (custom danmaku stack) or `native` (videojs skin). */
export function usePlayerEngine(): {
	readonly engine: PlayerEngine
	readonly setEngine: (next: PlayerEngine) => void
} {
	const api = usePluginAPI()
	const [engine, setEngineState] = useState<PlayerEngine>(() => {
		const raw = api.getPref(ENGINE_PREF_KEY)
		return raw === "native" ? "native" : "enhanced"
	})
	const setEngine = useCallback(
		(next: PlayerEngine) => {
			setEngineState(next)
			api.setPref(ENGINE_PREF_KEY, next)
		},
		[api],
	)
	return { engine, setEngine }
}

/** Persisted video sizing: `contain` letterboxes, `natural` never upscales. */
export function useFitMode(): {
	readonly fitMode: FitMode
	readonly setFitMode: (next: FitMode) => void
} {
	const api = usePluginAPI()
	const [fitMode, setFitModeState] = useState<FitMode>(() => {
		const raw = api.getPref(FIT_MODE_PREF_KEY)
		return raw === "natural" ? "natural" : "contain"
	})
	const setFitMode = useCallback(
		(next: FitMode) => {
			setFitModeState(next)
			api.setPref(FIT_MODE_PREF_KEY, next)
		},
		[api],
	)
	return { fitMode, setFitMode }
}

/**
 * Controlled playback: the caller flips this on when the surface becomes
 * active and off when it parks, so hidden copies preload silently.
 * `autoPlay` only fires on the initial mount, so transitions have to be
 * driven imperatively. Shared by both engines.
 */
export function useControlledPlayback(
	videoRef: React.RefObject<HTMLVideoElement | null>,
	playing: boolean | undefined,
): void {
	useEffect(() => {
		if (playing === undefined) return
		const video = videoRef.current
		if (video === null) return
		if (playing) video.play().catch(noopReject)
		else video.pause()
	}, [playing, videoRef])
}
