import * as React from "react"
import { fontArrayCodec } from "@/features/prefs"
import { usePrefSync } from "@/hooks/usePrefSync"
import {
	buildFontFamily,
	loadFontCss,
	loadPresetCssList,
	PRESET_FONTS,
	SYSTEM_FONT_TAGS,
} from "@/lib/fonts"
import { prefKeys } from "@/lib/keys"

type FontProviderState = {
	appFonts: readonly string[]
	fontFamily: string
	setAppFonts: (fonts: string[]) => void
}

const FontProviderContext = React.createContext<FontProviderState | undefined>(
	undefined,
)

export function FontProvider({
	children,
}: {
	readonly children: React.ReactNode
}) {
	const [appFonts, setAppFonts] = usePrefSync(
		prefKeys.appFont,
		SYSTEM_FONT_TAGS,
		fontArrayCodec,
	)

	const fontFamily = React.useMemo(() => buildFontFamily(appFonts), [appFonts])

	React.useEffect(() => {
		const root = document.documentElement
		root.style.setProperty("--font-app", fontFamily)
		loadPresetCssList(appFonts)
		// Pre-load preset stylesheets up front so a stored preference or a
		// picker click has the face ready. Idempotent; a no-op while
		// {@link PRESET_FONTS} is empty.
		for (const p of PRESET_FONTS) {
			if (p.cssPath) loadFontCss(p.cssPath)
		}
	}, [appFonts, fontFamily])

	const value = React.useMemo(
		() => ({
			appFonts,
			fontFamily,
			setAppFonts,
		}),
		[appFonts, fontFamily, setAppFonts],
	)

	return (
		<FontProviderContext.Provider value={value}>
			{children}
		</FontProviderContext.Provider>
	)
}

export function useFont(): FontProviderState {
	const context = React.useContext(FontProviderContext)
	if (context === undefined) {
		throw new Error("useFont must be used within a FontProvider")
	}
	return context
}
