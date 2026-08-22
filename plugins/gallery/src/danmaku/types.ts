/**
 * Shared types and constants for the {@link DanmakuPlayer} feature.
 *
 * Kept colocated with the other player modules so adding a new
 * preset (e.g. a new danmaku area) does not require touching the
 * main component file.
 */

export type DanmakuPlayerProps = {
	/**
	 * Stable per-resource sub-anchor (typically the gallery file's
	 * filename). Defaults to "" for resources that expose only one
	 * playable surface.
	 */
	readonly filename?: string
	readonly src: string
	readonly autoplay?: boolean
	/** Loop playback. When omitted the player does not loop. */
	readonly loop?: boolean
	/**
	 * Optional controlled playback state. When provided, the player
	 * imperatively plays or pauses to match every change of this flag.
	 * Leave undefined to keep the user-driven play/pause behaviour.
	 */
	readonly playing?: boolean
	/**
	 * Controls overlay mode:
	 *  - `full`      — the standard control bar with seek, volume,
	 *                  play/pause, fullscreen, etc. Default.
	 *  - `seek-only` — only a thin progress slider so the user can
	 *                  scrub without pinning the rest of the chrome
	 *                  over the video.
	 *  - `none`      — no controls at all (tap-to-toggle external).
	 */
	readonly controls?: "full" | "seek-only" | "none"
	/**
	 * Skip the per-file resume hooks (read on mount, throttled write
	 * while playing). Useful for surfaces that always play from the
	 * start, where a resume seek would pause the video half a second
	 * after autoplay starts.
	 */
	readonly disableResume?: boolean
	readonly className?: string
	/**
	 * Hide the inline danmaku send bar. The full control bar (seek,
	 * volume, play/pause, fullscreen, etc.) is still rendered. Used
	 * when danmaku is composed in an external surface but users still
	 * need to scrub the timeline.
	 */
	readonly hideSendBar?: boolean
	/**
	 * Optional controlled danmaku display settings. When provided the
	 * player treats them as the source of truth (and stops keeping its
	 * own internal copy), so the settings popover can live outside the
	 * player subtree.
	 */
	readonly settings?: DanmakuSettings
	readonly onSettingsChange?: (next: DanmakuSettings) => void
	/**
	 * Forwarded to the underlying `<video preload>` attribute. The
	 * default is `"metadata"` — enough to expose duration/dimensions
	 * without prefetching the bytes.
	 */
	readonly preload?: "none" | "metadata" | "auto"
	/**
	 * Probed video dimensions from `sourceMeta`, used to set an initial
	 * CSS `aspect-ratio` before the browser decodes `loadedmetadata`.
	 * Prevents the first painted frame from stretching to fill the
	 * player rect.
	 */
	readonly naturalSize?: { readonly w: number; readonly h: number }
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export const RESUME_THROTTLE_MS = 2000
export const RESUME_MIN_REMAINING_MS = 5
export const VOLUME_PREF_KEY = "player.volume"
export const VOLUME_THROTTLE_MS = 500
export const AUTOPLAY_PREF_KEY = "player.autoplay"
export const ENGINE_PREF_KEY = "engine"
export const FIT_MODE_PREF_KEY = "fitMode"
/** How long the "resumed from last position" badge stays visible. */
export const RESUME_HINT_DURATION_MS = 2000
export const DEFAULT_VIDEO_ASPECT = 16 / 9

export type PlayerEngine = "enhanced" | "native"
/**
 * `contain`  letterbox the video to the player frame.
 * `natural`  letterbox, but never upscale past the source resolution
 *            — useful for low-res clips where `contain` would blur
 *            them across the frame.
 */
export type FitMode = "contain" | "natural"
export const FIT_MODES = ["contain", "natural"] as const

/**
 * Playback snapshot the control surfaces render against. One object so
 * the control bar's state travels as a single prop instead of eight
 * loose scalars.
 */
export type PlayerPlaybackState = {
	readonly paused: boolean
	readonly currentMs: number
	readonly durationMs: number
	readonly volume: number
	readonly muted: boolean
	readonly rate: number
	readonly fullscreen: boolean
	readonly scrubbing: boolean
}

/**
 * Control-bar gesture handlers. Kept as one object so the player
 * passes one `actions` prop instead of a dozen callbacks.
 */
export type PlayerControlsActions = {
	readonly onTogglePlay: () => void
	readonly onSeek: (values: number | readonly number[]) => void
	readonly onSeekCommit: () => void
	readonly onVolumeChange: (values: number | readonly number[]) => void
	readonly onToggleMute: () => void
	readonly onRateChange: (rate: number) => void
	readonly onApplyRate: (rate: number) => void
	readonly onScreenshot: () => void
	readonly onTogglePip: () => void
	readonly onToggleFullscreen: () => void
	readonly onEngineChange: (next: PlayerEngine) => void
	readonly onFitModeChange: (next: FitMode) => void
	readonly onAutoplayChange: (next: boolean) => void
}

export const DANMAKU_AREA_PRESETS = [
	"quarter",
	"half",
	"threeQuarters",
	"full",
] as const
export type DanmakuArea = (typeof DANMAKU_AREA_PRESETS)[number]

export type DanmakuSettings = {
	readonly enabled: boolean
	readonly opacity: number
	readonly fontSizePx: number
	readonly area: DanmakuArea
}

export const DEFAULT_DANMAKU_SETTINGS: DanmakuSettings = {
	enabled: true,
	opacity: 1,
	fontSizePx: 24,
	area: "full",
}
