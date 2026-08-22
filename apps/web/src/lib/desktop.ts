import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"

export type {
	DesktopShellConfig,
	DesktopUpdateState,
	HoardodileDesktopBridge,
} from "@hoardodile/shared/desktop"

declare global {
	interface Window {
		hoardodileDesktop?: HoardodileDesktopBridge
	}
}

/** The Electron preload bridge, or `undefined` in a normal browser tab. */
export function getDesktopBridge(): HoardodileDesktopBridge | undefined {
	if (typeof window === "undefined") return undefined
	return window.hoardodileDesktop
}

export function isHoardodileDesktop(): boolean {
	return getDesktopBridge()?.isDesktop === true
}
