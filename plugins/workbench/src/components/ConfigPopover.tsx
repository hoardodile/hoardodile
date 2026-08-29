import { LANGUAGE_LABEL_KEYS } from "@hoardodile/i18n"
import { pluginThemePalettes } from "@hoardodile/sdk-web"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Separator } from "@hoardodile/ui/components/separator"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Settings } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import {
	WORKBENCH_LANGUAGES,
	WORKBENCH_PRESENTATION_MODES,
	type WorkbenchConfig,
} from "../config.ts"

/**
 * The config surface: every field maps to one iframe configuration item,
 * and the defaults mirror the main app's hardcoded defaults (see
 * src/config.ts). Changes apply live through the host pushes — no iframe
 * remount (Reload re-posts the full context).
 */
export function ConfigPopover(props: {
	readonly config: WorkbenchConfig
	readonly onChange: (patch: Partial<WorkbenchConfig>) => void
}) {
	const { config, onChange } = props
	// Shared catalog keys (theme/icon/language option names) come from the
	// default namespace; the workbench's own copy from the workbench ns.
	const { t } = useTranslation()
	const { t: tw } = useTranslation("workbench")

	const themeModeOptions = [
		{ value: "system", label: t("theme.mode.system") },
		{ value: "light", label: t("theme.mode.light") },
		{ value: "dark", label: t("theme.mode.dark") },
	] as const

	const paletteOptions = pluginThemePalettes.map((palette) => ({
		value: palette,
		label: t(`theme.palette.${palette}`),
	}))

	const iconStyleOptions = (["duotone", "grayscale", "linear"] as const).map(
		(style) => ({ value: style, label: t(`icons.style.${style}`) }),
	)

	const languageOptions = [
		{ value: "system", label: tw("popover.system") },
		...WORKBENCH_LANGUAGES.map((code) => ({
			value: code,
			label: t(LANGUAGE_LABEL_KEYS[code]),
		})),
	]

	const modeOptions = WORKBENCH_PRESENTATION_MODES.map((mode) => ({
		value: mode,
		label: tw(`mode.${mode}`),
	}))

	return (
		<Popover closeOnBlur>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button
									variant="outline"
									size="sm"
									aria-label={tw("popover.settingsAria")}
								>
									<Icon icon={Settings} className="text-secondary-foreground" />
									<span className="max-md:hidden">
										{tw("popover.configure")}
									</span>
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>{tw("popover.tooltip")}</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
				<PopoverHeader>
					<PopoverTitle>{tw("popover.title")}</PopoverTitle>
					<PopoverDescription>{tw("popover.description")}</PopoverDescription>
				</PopoverHeader>

				<SectionLabel>{tw("popover.sectionAppearance")}</SectionLabel>
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Label className="text-xs">{t("theme.modeLabel")}</Label>
						<PillTabs
							value={config.themeMode}
							items={themeModeOptions}
							onChange={(value) => onChange({ themeMode: value })}
							className="flex-wrap"
						/>
					</div>
					<div className="flex items-center justify-between gap-3">
						<Label className="text-xs">{t("theme.paletteLabel")}</Label>
						<DropdownSelect
							value={config.palette}
							onValueChange={(value) =>
								onChange({ palette: value as WorkbenchConfig["palette"] })
							}
							options={paletteOptions}
							aria-label={t("theme.paletteLabel")}
						/>
					</div>
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionIcons")}</SectionLabel>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-xs">{tw("popover.style")}</Label>
					<DropdownSelect
						value={config.iconStyle}
						onValueChange={(value) =>
							onChange({ iconStyle: value as WorkbenchConfig["iconStyle"] })
						}
						options={iconStyleOptions}
						aria-label={tw("popover.style")}
					/>
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionLanguage")}</SectionLabel>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-xs">{tw("popover.uiLanguage")}</Label>
					<DropdownSelect
						value={config.language}
						onValueChange={(value) => onChange({ language: value })}
						options={languageOptions}
						aria-label={tw("popover.sectionLanguage")}
					/>
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionFont")}</SectionLabel>
				<div className="flex flex-col gap-2">
					<Label className="text-xs">{tw("popover.fontFamily")}</Label>
					<Input
						value={config.fontFamily}
						onChange={(event) => onChange({ fontFamily: event.target.value })}
						placeholder={tw("popover.fontFamilyPlaceholder")}
						aria-label={tw("popover.fontFamily")}
					/>
					<p className="text-xs text-muted-foreground">
						{tw("popover.fontFamilyHint")}
					</p>
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionPresentation")}</SectionLabel>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-xs">{tw("popover.mode")}</Label>
					<PillTabs
						value={config.mode}
						items={modeOptions}
						onChange={(value) => onChange({ mode: value })}
						className="flex-wrap"
					/>
				</div>
			</PopoverContent>
		</Popover>
	)
}
