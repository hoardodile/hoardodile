import { LANGUAGE_LABEL_KEYS } from "@hoardodile/i18n"
import { pluginThemePalettes } from "@hoardodile/sdk-web"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Separator } from "@hoardodile/ui/components/separator"
import { Eraser, Restart } from "@hoardodile/ui/icons/registry"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
	WORKBENCH_LANGUAGES,
	WORKBENCH_PRESENTATION_MODES,
	type WorkbenchConfig,
} from "../config.ts"

/** Plugin-state status surfaced in the dialog. */
export type PluginStateView = {
	/** The plugin's settings were explicitly reset (empty baseline). */
	readonly prefsCleared: boolean
	/** The plugin+resource cache was explicitly cleared (empty baseline). */
	readonly cacheCleared: boolean
	/** Any prefs session state exists (a reset or recorded writes) — gates Restore. */
	readonly prefsChanged: boolean
	/** Any cache session state exists (a reset or recorded writes) — gates Restore. */
	readonly cacheChanged: boolean
}

/**
 * The iframe-settings dialog (opened from the menu bar): every field maps
 * to one iframe configuration item, and the defaults mirror the main
 * app's hardcoded defaults. Changes apply live through the host pushes —
 * no iframe remount (Reload re-posts the full context).
 */
export function ConfigDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly config: WorkbenchConfig
	readonly onChange: (patch: Partial<WorkbenchConfig>) => void
	readonly pluginState: PluginStateView
	readonly disabled: boolean
	readonly cacheDisabled: boolean
	readonly onResetSettings: () => void
	readonly onClearCache: () => void
	readonly onRestoreState: () => void
}) {
	const {
		open,
		onOpenChange,
		config,
		onChange,
		pluginState,
		disabled,
		cacheDisabled,
		onResetSettings,
		onClearCache,
		onRestoreState,
	} = props
	const [confirm, setConfirm] = useState<"prefs" | "cache" | null>(null)
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
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>{tw("popover.title")}</DialogTitle>
						<DialogDescription>{tw("popover.description")}</DialogDescription>
					</DialogHeader>
					<DialogBody className="flex flex-col gap-3 pb-6">
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
								onChange={(event) =>
									onChange({ fontFamily: event.target.value })
								}
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

						<Separator />

						<SectionLabel>{tw("popover.sectionPluginState")}</SectionLabel>
						<div className="flex flex-col gap-3">
							<p className="text-xs text-muted-foreground">
								{tw("popover.pluginStateHint")}
							</p>
							<div className="flex items-center justify-between gap-3">
								<Label className="text-xs">
									{tw("popover.columnSettings")}
								</Label>
								<div className="flex items-center gap-2">
									{pluginState.prefsCleared ? (
										<span className="text-xs text-muted-foreground">
											{tw("popover.prefsCleared")}
										</span>
									) : null}
									<Button
										variant="destructive"
										size="sm"
										data-testid="plugin-reset-settings"
										onClick={() => setConfirm("prefs")}
										disabled={disabled}
									>
										<Icon icon={Restart} />
										{tw("popover.reset")}
									</Button>
								</div>
							</div>
							<div className="flex items-center justify-between gap-3">
								<Label className="text-xs">{tw("popover.columnCache")}</Label>
								<div className="flex items-center gap-2">
									{pluginState.cacheCleared ? (
										<span className="text-xs text-muted-foreground">
											{tw("popover.cacheCleared")}
										</span>
									) : null}
									<Button
										variant="destructive"
										size="sm"
										data-testid="plugin-clear-cache"
										onClick={() => setConfirm("cache")}
										disabled={cacheDisabled}
									>
										<Icon icon={Eraser} />
										{tw("popover.clear")}
									</Button>
								</div>
							</div>
							{pluginState.prefsChanged || pluginState.cacheChanged ? (
								<Button
									variant="ghost"
									size="sm"
									className="self-start"
									data-testid="plugin-restore-state"
									onClick={onRestoreState}
									disabled={disabled}
								>
									{tw("popover.restoreState")}
								</Button>
							) : null}
						</div>
					</DialogBody>
				</DialogContent>
			</Dialog>

			<ConfirmDialog
				open={confirm !== null}
				onOpenChange={(open) => {
					if (!open) setConfirm(null)
				}}
				title={
					confirm === "prefs"
						? tw("popover.resetPrefsConfirmTitle")
						: tw("popover.clearCacheConfirmTitle")
				}
				description={
					confirm === "prefs"
						? tw("popover.resetPrefsConfirmDescription")
						: tw("popover.clearCacheConfirmDescription")
				}
				confirmLabel={
					confirm === "prefs" ? tw("popover.reset") : tw("popover.clear")
				}
				isPending={false}
				destructive
				onConfirm={() => {
					if (confirm === "prefs") onResetSettings()
					else if (confirm === "cache") onClearCache()
					setConfirm(null)
				}}
			/>
		</>
	)
}
