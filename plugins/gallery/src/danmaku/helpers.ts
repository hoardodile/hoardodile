import type { Danmaku as DanmakuRecord } from "@hoardodile/sdk-web"
import { decodeVideoTimeAnchor } from "../shared"
import { DANMAKU_AREA_PRESETS, type DanmakuArea } from "./types"

export function toEngineComment(d: DanmakuRecord, fontSizePx: number) {
	const mode = d.mode === "scroll" ? "rtl" : d.mode
	const anchor = decodeVideoTimeAnchor(d.anchor.data)
	const timeMs = anchor?.timeMs ?? 0
	return {
		text: d.text,
		mode,
		time: timeMs / 1000,
		style: {
			fontSize: `${fontSizePx}px`,
			color: d.color !== "" ? d.color : "#ffffff",
			textShadow: "0 0 1px #000, 0 0 1px #000, 0 0 1px #000, 0 0 1px #000",
		},
	} satisfies {
		text: string
		mode: "rtl" | "top" | "bottom"
		time: number
		style: Partial<CSSStyleDeclaration>
	}
}

export function isDanmakuArea(v: string): v is DanmakuArea {
	return (DANMAKU_AREA_PRESETS as readonly string[]).includes(v)
}

export function areaToHeight(area: DanmakuArea): string {
	switch (area) {
		case "quarter":
			return "25%"
		case "half":
			return "50%"
		case "threeQuarters":
			return "75%"
		case "full":
			return "100%"
	}
}

export function formatTime(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "00:00"
	const totalSec = Math.floor(ms / 1000)
	const h = Math.floor(totalSec / 3600)
	const m = Math.floor((totalSec % 3600) / 60)
	const s = totalSec % 60
	const mm = String(m).padStart(2, "0")
	const ss = String(s).padStart(2, "0")
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function noopReject() {
	// Best-effort wrapper for play / requestPictureInPicture /
	// requestFullscreen / mutation invalidate. The browser surfaces
	// permission errors via UI on its own.
}
