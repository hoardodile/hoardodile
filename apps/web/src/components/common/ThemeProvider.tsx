import { pluginThemePalettes } from "@hoardodile/sdk-web"
import * as React from "react"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"

type Theme = "dark" | "light" | "system"
type ResolvedTheme = "dark" | "light"

/**
 * Hardcoded theme palettes. The ids come from the single source of truth
 * `pluginThemePalettes` in `@hoardodile/sdk-web`; each id maps to a
 * `.theme-<id>` stylesheet block in `@hoardodile/ui/theme.css` and a
 * `theme.palette.<id>` i18n label (both covered by tests). Selecting a
 * palette toggles the matching class on `<html>`. Users cannot author new
 * palettes — only pick from this registry.
 */
export const THEME_PALETTES = pluginThemePalettes.map((id) => ({
	id,
	labelKey: `theme.palette.${id}`,
}))

export type ThemePalette = (typeof THEME_PALETTES)[number]["id"]

type ThemeProviderProps = {
	children: React.ReactNode
	defaultTheme?: Theme
	defaultPalette?: ThemePalette
	storageKey?: string
	paletteStorageKey?: string
	disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
	theme: Theme
	resolvedTheme: ResolvedTheme
	setTheme: (theme: Theme) => void
	palette: ThemePalette
	setPalette: (palette: ThemePalette) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEME_VALUES = [
	"dark",
	"light",
	"system",
] as const satisfies readonly Theme[]

const ThemeProviderContext = React.createContext<
	ThemeProviderState | undefined
>(undefined)

function isTheme(value: string | undefined): value is Theme {
	if (value === undefined) {
		return false
	}
	for (const candidate of THEME_VALUES) {
		if (candidate === value) return true
	}
	return false
}

function isPalette(value: string | undefined): value is ThemePalette {
	if (value === undefined) return false
	for (const candidate of pluginThemePalettes) {
		if (candidate === value) return true
	}
	return false
}

function orUndefined<T>(value: T | null): T | undefined {
	return value === null ? undefined : value
}

function getSystemTheme(): ResolvedTheme {
	if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
		return "dark"
	}

	return "light"
}

function disableTransitionsTemporarily() {
	const style = document.createElement("style")
	style.appendChild(
		document.createTextNode(
			"*,*::before,*::after{-webkit-transition:none!important;transition:none!important}",
		),
	)
	document.head.appendChild(style)

	return () => {
		window.getComputedStyle(document.body)
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				style.remove()
			})
		})
	}
}

export function ThemeProvider({
	children,
	defaultTheme = "system",
	defaultPalette = "mono",
	// These two keys + the `"mono"` palette literal are duplicated in
	// `apps/web/index.html`'s pre-hydration script. Keep them in sync.
	storageKey = prefKeys.theme,
	paletteStorageKey = prefKeys.themePalette,
	disableTransitionOnChange = true,
	...props
}: ThemeProviderProps) {
	const [theme, setThemeState] = React.useState<Theme>(() => {
		const storedTheme = orUndefined(prefSync.get(storageKey))
		if (isTheme(storedTheme)) {
			return storedTheme
		}

		return defaultTheme
	})

	const [palette, setPaletteState] = React.useState<ThemePalette>(() => {
		const stored = orUndefined(prefSync.get(paletteStorageKey))
		if (isPalette(stored)) return stored
		return defaultPalette
	})

	const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(
		() => {
			const stored = orUndefined(prefSync.get(storageKey))
			const effective = isTheme(stored) ? stored : defaultTheme
			return effective === "system" ? getSystemTheme() : effective
		},
	)

	const setTheme = React.useCallback(
		(nextTheme: Theme) => {
			prefSync.set(storageKey, nextTheme)
			setThemeState(nextTheme)
		},
		[storageKey],
	)

	const setPalette = React.useCallback(
		(nextPalette: ThemePalette) => {
			prefSync.set(paletteStorageKey, nextPalette)
			setPaletteState(nextPalette)
		},
		[paletteStorageKey],
	)

	const applyTheme = React.useCallback(
		(nextTheme: Theme, nextPalette: ThemePalette) => {
			const root = document.documentElement
			const resolved: ResolvedTheme =
				nextTheme === "system" ? getSystemTheme() : nextTheme
			setResolvedTheme(resolved)
			const restoreTransitions = disableTransitionOnChange
				? disableTransitionsTemporarily()
				: undefined

			root.classList.remove("light", "dark")
			root.classList.add(resolved)

			// Strip any previous palette classes generically, then add the
			// active one. `mono` has no class — it lives in `:root` / `.dark`.
			for (const cls of [...root.classList]) {
				if (cls.startsWith("theme-")) root.classList.remove(cls)
			}
			if (nextPalette !== "mono") {
				root.classList.add(`theme-${nextPalette}`)
			}

			if (restoreTransitions) {
				restoreTransitions()
			}
		},
		[disableTransitionOnChange],
	)

	React.useEffect(() => {
		applyTheme(theme, palette)

		if (theme !== "system") {
			return undefined
		}

		const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
		function handleChange() {
			applyTheme("system", palette)
		}

		mediaQuery.addEventListener("change", handleChange)

		return () => {
			mediaQuery.removeEventListener("change", handleChange)
		}
	}, [theme, palette, applyTheme])

	const value = React.useMemo(
		() => ({
			theme,
			resolvedTheme,
			setTheme,
			palette,
			setPalette,
		}),
		[theme, resolvedTheme, setTheme, palette, setPalette],
	)

	return (
		<ThemeProviderContext.Provider {...props} value={value}>
			{children}
		</ThemeProviderContext.Provider>
	)
}

export function useTheme() {
	const context = React.useContext(ThemeProviderContext)

	if (context === undefined) {
		throw new Error("useTheme must be used within a ThemeProvider")
	}

	return context
}
