import * as React from "react"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"

/** Icon rendering styles (DESIGN.md — Iconography):
    `duotone` (default) lets the second tone take the palette's `--icon-tone`
    hue, `grayscale` keeps the two tones in plain ink, `linear` renders the
    thin-line Linear glyphs. Applied as `data-icon-style` on `<html>` —
    theme.css recolors the `.hd-icon` hook under it; the Tone exports in
    `@hoardodile/ui/icons/registry` swap to Linear themselves in
    `linear` mode. */
export const ICON_STYLES = ["duotone", "grayscale", "linear"] as const

export type IconStyle = (typeof ICON_STYLES)[number]

type IconStyleProviderProps = {
	children: React.ReactNode
	defaultStyle?: IconStyle
	storageKey?: string
}

type IconStyleProviderState = {
	iconStyle: IconStyle
	setIconStyle: (style: IconStyle) => void
}

const IconStyleContext = React.createContext<
	IconStyleProviderState | undefined
>(undefined)

function isIconStyle(value: string | undefined): value is IconStyle {
	if (value === undefined) return false
	for (const candidate of ICON_STYLES) {
		if (candidate === value) return true
	}
	return false
}

/**
 * Icon style preference provider — persists the choice via
 * {@link prefSync} (survives reloads, syncs to the server) and applies it
 * as `data-icon-style` on `<html>` so every `.hd-icon` follows.
 */
export function IconStyleProvider({
	children,
	defaultStyle = "duotone",
	storageKey = prefKeys.iconStyle,
	...props
}: IconStyleProviderProps) {
	const [iconStyle, setIconStyleState] = React.useState<IconStyle>(() => {
		const stored = prefSync.get(storageKey)
		return isIconStyle(stored) ? stored : defaultStyle
	})

	const setIconStyle = React.useCallback(
		(nextStyle: IconStyle) => {
			prefSync.set(storageKey, nextStyle)
			setIconStyleState(nextStyle)
		},
		[storageKey],
	)

	React.useEffect(() => {
		document.documentElement.dataset.iconStyle = iconStyle
	}, [iconStyle])

	const value = React.useMemo(
		() => ({ iconStyle, setIconStyle }),
		[iconStyle, setIconStyle],
	)

	return (
		<IconStyleContext.Provider {...props} value={value}>
			{children}
		</IconStyleContext.Provider>
	)
}

export function useIconStyle() {
	const context = React.useContext(IconStyleContext)

	if (context === undefined) {
		throw new Error("useIconStyle must be used within an IconStyleProvider")
	}

	return context
}
