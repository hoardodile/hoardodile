/**
 * Mono canvas fill for the native window chrome.
 * Tokens: `packages/ui/src/styles/theme.css` `:root --background` /
 * `.dark --background`. BrowserWindow needs hex, not oklch.
 */
const MONO_LIGHT_BACKGROUND = "#fbfbfb"
/** `oklch(0.12 0 0)` encoded as sRGB. */
const MONO_DARK_BACKGROUND = "#060606"

export function windowBackgroundColor(dark: boolean): string {
	if (dark) return MONO_DARK_BACKGROUND
	return MONO_LIGHT_BACKGROUND
}
