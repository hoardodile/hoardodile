import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import {
	RadioGroup,
	RadioGroupItem,
} from "@hoardodile/ui/components/radio-group"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { FontPicker } from "@/components/common/FontPicker"
import { useFont } from "@/components/common/FontProvider"
import { THEME_PALETTES } from "@/components/common/ThemeProvider"
import { useDocFontSlot } from "@/features/doc/hooks/useDocFontSlot"
import {
	DOC_READING_WIDTHS,
	useDocReadingWidth,
	useDocTheme,
} from "@/features/doc/hooks/useDocPrefs"
import { DOC_PAGE_FONT_TAGS } from "@/lib/fonts"
import { prefKeys } from "@/lib/keys"

export type DocAppearanceSettingsDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}

/**
 * Unified appearance dialog for the document area.
 *
 * Groups theme (palette / inherit), reading width and font settings.
 * The editor font is a single body stack (like the app font); the page
 * font splits into Body / Headings tabs. Each picker keeps its stack
 * editable while the inherit switch decides whether it applies.
 */
export function DocAppearanceSettingsDialog(
	props: DocAppearanceSettingsDialogProps,
) {
	const { t } = useTranslation()
	const { theme, themeClass, setTheme } = useDocTheme()
	const { readingWidth, setReadingWidth } = useDocReadingWidth()
	const { appFonts, fontFamily } = useFont()
	const editorFont = useDocFontSlot(
		prefKeys.docEditorFont,
		prefKeys.docEditorFontInherit,
	)
	const uiBodyFont = useDocFontSlot(
		prefKeys.docUiFont,
		prefKeys.docUiFontInherit,
		DOC_PAGE_FONT_TAGS,
	)
	const uiHeadingFont = useDocFontSlot(
		prefKeys.docUiHeadingFont,
		prefKeys.docUiHeadingFontInherit,
		DOC_PAGE_FONT_TAGS,
	)
	const [uiFontTab, setUiFontTab] = useState("body")

	function handleThemeChange(next: string) {
		if (next === "inherit") {
			setTheme("inherit")
			return
		}
		for (const palette of THEME_PALETTES) {
			if (palette.id === next) {
				setTheme(palette.id)
				return
			}
		}
	}

	return (
		<AppDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			contentClassName={cn("doc max-h-[90svh] overflow-y-auto", themeClass)}
			title={t("documents.appearanceSettings.title")}
			description={t("documents.appearanceSettings.description")}
			size="2xl"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => props.onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<div className="flex flex-col gap-6">
				<section className="flex flex-col gap-3">
					<h3 className="text-xs font-semibold tracking-label uppercase text-foreground">
						{t("documents.appearanceSettings.theme")}
					</h3>
					<DropdownSelect
						value={theme}
						onValueChange={handleThemeChange}
						options={[
							{
								value: "inherit",
								label: t("documents.appearanceSettings.inherit"),
							},
							...THEME_PALETTES.map((palette) => ({
								value: palette.id,
								label: t(palette.labelKey),
							})),
						]}
						placeholder={t("documents.appearanceSettings.theme")}
						aria-label={t("documents.appearanceSettings.theme")}
						data-testid="doc-theme-select"
					/>
				</section>

				<section className="flex flex-col gap-3">
					<h3 className="text-xs font-semibold tracking-label uppercase text-foreground">
						{t("documents.appearanceSettings.readingWidth")}
					</h3>
					<p className="text-xs text-muted-foreground">
						{t("documents.appearanceSettings.readingWidthDescription")}
					</p>
					<RadioGroup
						value={String(readingWidth)}
						onValueChange={(value) => setReadingWidth(Number(value))}
						className="gap-2"
						data-testid="doc-reading-width"
					>
						{DOC_READING_WIDTHS.map((width) => (
							<div key={width} className="flex items-center gap-2">
								<RadioGroupItem
									value={String(width)}
									aria-label={`${width}px`}
								/>
								<span className="text-sm">{width}px</span>
							</div>
						))}
					</RadioGroup>
				</section>

				<section className="flex flex-col gap-3">
					<h3 className="text-xs font-semibold tracking-label uppercase text-foreground">
						{t("documents.appearanceSettings.editorFont")}
					</h3>
					<p className="text-xs text-muted-foreground">
						{t("documents.appearanceSettings.editorFontDescription")}
					</p>
					<FontPicker
						value={editorFont.fonts}
						onChange={editorFont.setFonts}
						inherit={editorFont.inherit}
						onInheritChange={editorFont.setInherit}
						inheritedFonts={appFonts}
						inheritedFamily={fontFamily}
						data-testid="doc-editor-font-picker"
						aria-label={t("documents.appearanceSettings.editorFont")}
					/>
				</section>

				<section className="flex flex-col gap-3">
					<h3 className="text-xs font-semibold tracking-label uppercase text-foreground">
						{t("documents.appearanceSettings.uiFont")}
					</h3>
					<p className="text-xs text-muted-foreground">
						{t("documents.appearanceSettings.uiFontDescription")}
					</p>
					<SectionTabs
						value={uiFontTab}
						onChange={setUiFontTab}
						items={[
							{
								value: "body",
								label: t("documents.appearanceSettings.body"),
								panelClassName: "pt-3",
								panel: (
									<FontPicker
										value={uiBodyFont.fonts}
										onChange={uiBodyFont.setFonts}
										inherit={uiBodyFont.inherit}
										onInheritChange={uiBodyFont.setInherit}
										inheritedFonts={appFonts}
										inheritedFamily={fontFamily}
										data-testid="doc-ui-font-picker"
										aria-label={t("documents.appearanceSettings.uiFont")}
									/>
								),
							},
							{
								value: "headings",
								label: t("documents.appearanceSettings.headings"),
								panelClassName: "pt-3",
								panel: (
									<FontPicker
										value={uiHeadingFont.fonts}
										onChange={uiHeadingFont.setFonts}
										inherit={uiHeadingFont.inherit}
										onInheritChange={uiHeadingFont.setInherit}
										inheritedFonts={appFonts}
										inheritedFamily={fontFamily}
										data-testid="doc-ui-heading-font-picker"
										aria-label={t("documents.appearanceSettings.uiFont")}
									/>
								),
							},
						]}
					/>
				</section>
			</div>
		</AppDialog>
	)
}
