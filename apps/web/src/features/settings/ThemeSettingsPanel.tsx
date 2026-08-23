import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { useTranslation } from "react-i18next"
import {
	THEME_PALETTES,
	type ThemePalette,
	useTheme,
} from "@/components/common/ThemeProvider"
import { loose } from "@/i18n"
import { ChoiceCard } from "./ChoiceCard"

const MODE_OPTIONS = [
	{ id: "light", labelKey: "theme.mode.light" },
	{ id: "dark", labelKey: "theme.mode.dark" },
	{ id: "system", labelKey: "theme.mode.system" },
] as const

type ThemeMode = (typeof MODE_OPTIONS)[number]["id"]

/** Palette swatch triads — canvas / ink / accent approximations. */
const PALETTE_SWATCHES: Record<
	ThemePalette,
	readonly [string, string, string]
> = {
	mono: ["#fbfbfb", "#101010", "#9a9a96"],
	sage: ["#f5f6f0", "#212920", "#5f6d5b"],
	parchment: ["#d9c7a3", "#302202", "#966500"],
	azure: ["#fbfbfc", "#161718", "#02aeee"],
	hoardodile: ["#fbfbfb", "#101010", "#758a23"],
}

/**
 * Theme settings panel: Mode and Palette each render as a 3-column grid
 * of choice cards with a miniature preview (the mode cards sketch the app
 * chrome; the palette cards show the palette's swatch triad).
 */
export function ThemeSettingsPanel() {
	const { t } = useTranslation()
	const { theme, setTheme, palette, setPalette } = useTheme()

	return (
		<div className="flex flex-col gap-5">
			<section>
				<SectionLabel>{t("theme.modeLabel")}</SectionLabel>
				<div className="mt-3 grid grid-cols-3 gap-3">
					{MODE_OPTIONS.map((opt) => (
						<ChoiceCard
							key={opt.id}
							label={t(opt.labelKey)}
							selected={theme === opt.id}
							onSelect={() => setTheme(opt.id as ThemeMode)}
						>
							<ThemePreview mode={opt.id} />
						</ChoiceCard>
					))}
				</div>
			</section>
			<section>
				<SectionLabel>{t("theme.paletteLabel")}</SectionLabel>
				<div className="mt-3 grid grid-cols-3 gap-3">
					{THEME_PALETTES.map((p) => (
						<ChoiceCard
							key={p.id}
							label={loose(t)(p.labelKey)}
							selected={palette === p.id}
							onSelect={() => setPalette(p.id)}
						>
							<div className="flex h-16 items-center justify-center gap-1.5">
								{PALETTE_SWATCHES[p.id].map((swatch) => (
									<span
										key={swatch}
										className="size-5 rounded-full ring-1 ring-foreground/10"
										style={{ background: swatch }}
									/>
								))}
							</div>
						</ChoiceCard>
					))}
				</div>
			</section>
		</div>
	)
}

/**
 * Miniature app sketch inside a theme-mode choice card. The dark variant
 * nests a `dark` scope so both halves render real tokens, not hard-coded
 * grays; "system" splits the sketch in two.
 */
function ThemePreview({ mode }: { mode: ThemeMode }) {
	if (mode === "system") {
		return (
			<div className="grid h-16 grid-cols-2">
				<ThemeSketch />
				<div className="dark">
					<ThemeSketch />
				</div>
			</div>
		)
	}
	const sketch = <ThemeSketch />
	return mode === "dark" ? <div className="dark">{sketch}</div> : sketch
}

function ThemeSketch() {
	return (
		<div className="flex h-16 gap-1.5 bg-background p-2">
			<div className="flex w-7 flex-col gap-1">
				<div className="h-1.5 rounded-full bg-foreground/70" />
				<div className="h-1 rounded-full bg-muted-foreground/40" />
				<div className="h-1 rounded-full bg-muted-foreground/40" />
			</div>
			<div className="flex flex-1 flex-col gap-1.5">
				<div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/40" />
				<div className="grid flex-1 grid-cols-3 gap-1">
					<div className="rounded-sm bg-muted" />
					<div className="rounded-sm bg-muted" />
					<div className="rounded-sm bg-muted" />
				</div>
			</div>
		</div>
	)
}
