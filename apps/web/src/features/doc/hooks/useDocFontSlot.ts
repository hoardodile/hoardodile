import { useCallback } from "react"
import { fontArrayCodec } from "@/features/prefs"
import { usePrefSync, useStringPrefSync } from "@/hooks/usePrefSync"
import { buildFontFamily } from "@/lib/fonts"

/**
 * One document font slot (page body, page headings, or editor body): a
 * font stack plus an independent "inherit app font" switch. The stack
 * stays stored while inheriting — the switch only decides whether it is
 * applied (`fontFamily` resolves to "" so the CSS fallback chain takes
 * over). While the inherit pref is unset, it falls back to "stack is
 * empty" so users who configured fonts before the switch existed keep
 * their behavior.
 *
 * `defaultFonts` is the stack used until the user touches the pref —
 * e.g. the documents page font defaults to the reading serif.
 */
export function useDocFontSlot(
	fontKey: string,
	inheritKey: string,
	defaultFonts: readonly string[] = [],
) {
	const [fonts, setFonts] = usePrefSync(fontKey, defaultFonts, fontArrayCodec)
	const [inheritRaw, setInheritRaw] = useStringPrefSync(inheritKey, "")
	const inherit = inheritRaw === "" ? fonts.length === 0 : inheritRaw === "1"

	const setInherit = useCallback(
		function setInherit(next: boolean) {
			setInheritRaw(next ? "1" : "0")
		},
		[setInheritRaw],
	)

	const fontFamily = inherit ? "" : buildFontFamily(fonts)

	return { fonts, setFonts, inherit, setInherit, fontFamily }
}
