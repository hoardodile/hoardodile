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
import { cn } from "@hoardodile/ui/lib/utils"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { useEffect, useState } from "react"
import {
	CUSTOM_VIEWPORT_DEFAULT,
	ICON_STYLE_LABELS,
	LANGUAGE_LABELS,
	PALETTE_LABELS,
	VIEWPORT_MAX_PX,
	VIEWPORT_MIN_PX,
	VIEWPORT_PRESETS,
	viewportPresetId,
	WORKBENCH_LANGUAGES,
	type WorkbenchConfig,
} from "../config.ts"

const THEME_MODE_OPTIONS = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const

const PALETTE_OPTIONS = pluginThemePalettes.map((palette) => ({
	value: palette,
	label: PALETTE_LABELS[palette],
}))

const ICON_STYLE_OPTIONS = (["duotone", "grayscale", "linear"] as const).map(
	(style) => ({ value: style, label: ICON_STYLE_LABELS[style] }),
)

const LANGUAGE_OPTIONS = [
	{ value: "system", label: "System" },
	...WORKBENCH_LANGUAGES.map((code) => ({
		value: code,
		label: LANGUAGE_LABELS[code],
	})),
]

const VIEWPORT_OPTIONS = [
	...VIEWPORT_PRESETS.map((preset) => ({
		value: preset.id,
		label: `${preset.label}${preset.width === null ? "" : ` ${preset.width}×${preset.height}`}`,
	})),
	{ value: "custom", label: "Custom" },
]

function clampViewportSize(value: number): number {
	return Math.min(VIEWPORT_MAX_PX, Math.max(VIEWPORT_MIN_PX, value))
}

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
	const viewport = config.viewport
	const viewportIsFill = viewport.width === null || viewport.height === null
	const viewportDims = {
		width: viewport.width === null ? "" : String(viewport.width),
		height: viewport.height === null ? "" : String(viewport.height),
	}
	// Local draft while typing: the config only commits on blur/Enter, so
	// typing "1200" never passes through clamped intermediates.
	const [draft, setDraft] = useState<{ width: string; height: string } | null>(
		null,
	)
	useEffect(() => {
		setDraft(null)
	}, [viewport.width, viewport.height])
	const draftDims = draft ?? viewportDims

	function commitViewportDims(): void {
		if (draft === null) return
		const parsedW = draft.width === "" ? null : Number(draft.width)
		const parsedH = draft.height === "" ? null : Number(draft.height)
		const validW = parsedW !== null && Number.isFinite(parsedW)
		const validH = parsedH !== null && Number.isFinite(parsedH)
		if (validW && validH) {
			onChange({
				viewport: {
					width: clampViewportSize(Math.round(parsedW)),
					height: clampViewportSize(Math.round(parsedH)),
				},
			})
		} else if (!validW && !validH) {
			// Both fields cleared: back to Fill.
			onChange({ viewport: { width: null, height: null } })
		}
		// One side emptied: keep the current dims until both are valid or
		// empty — a half-edited custom size is not actionable.
		setDraft(null)
	}

	function commitOnEnter(event: ReactKeyboardEvent<HTMLInputElement>): void {
		if (event.key !== "Enter") return
		event.currentTarget.blur()
	}

	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button
									variant="outline"
									size="sm"
									aria-label="Iframe settings"
								>
									<Icon icon={Settings} className="text-secondary-foreground" />
									Configure
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>Iframe settings — applied live</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-80">
				<PopoverHeader>
					<PopoverTitle>Iframe settings</PopoverTitle>
					<PopoverDescription>
						Live updates without reloading the plugin; defaults match the main
						app.
					</PopoverDescription>
				</PopoverHeader>

				<SectionLabel>Appearance</SectionLabel>
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-3">
						<Label className="text-xs">Mode</Label>
						<PillTabs
							value={config.themeMode}
							items={THEME_MODE_OPTIONS}
							onChange={(value) => onChange({ themeMode: value })}
						/>
					</div>
					<div className="flex items-center justify-between gap-3">
						<Label className="text-xs">Palette</Label>
						<DropdownSelect
							value={config.palette}
							onValueChange={(value) =>
								onChange({ palette: value as WorkbenchConfig["palette"] })
							}
							options={PALETTE_OPTIONS}
							aria-label="Palette"
						/>
					</div>
				</div>

				<Separator />

				<SectionLabel>Icons</SectionLabel>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-xs">Style</Label>
					<DropdownSelect
						value={config.iconStyle}
						onValueChange={(value) =>
							onChange({ iconStyle: value as WorkbenchConfig["iconStyle"] })
						}
						options={ICON_STYLE_OPTIONS}
						aria-label="Icon style"
					/>
				</div>

				<Separator />

				<SectionLabel>Language</SectionLabel>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-xs">UI language</Label>
					<DropdownSelect
						value={config.language}
						onValueChange={(value) => onChange({ language: value })}
						options={LANGUAGE_OPTIONS}
						aria-label="Language"
					/>
				</div>

				<Separator />

				<SectionLabel>Font</SectionLabel>
				<div className="flex flex-col gap-2">
					<Label className="text-xs">Font family</Label>
					<Input
						value={config.fontFamily}
						onChange={(event) => onChange({ fontFamily: event.target.value })}
						placeholder="App default (system stack)"
						aria-label="Font family"
					/>
					<p className="text-xs text-muted-foreground">
						Leave empty for the app default system stack.
					</p>
				</div>

				<Separator />

				<SectionLabel>Viewport</SectionLabel>
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						<Label className="text-xs">Size</Label>
						<DropdownSelect
							value={viewportPresetId(viewport)}
							onValueChange={(value) => {
								const preset = VIEWPORT_PRESETS.find((p) => p.id === value)
								if (value === "custom") {
									const base = viewportIsFill
										? CUSTOM_VIEWPORT_DEFAULT
										: viewport
									onChange({
										viewport: {
											width: base.width,
											height: base.height,
										},
									})
								} else if (preset !== undefined) {
									onChange({
										viewport: {
											width: preset.width,
											height: preset.height,
										},
									})
								}
							}}
							options={VIEWPORT_OPTIONS}
							aria-label="Viewport size"
						/>
					</div>
					<div className="flex items-center gap-2">
						<Input
							className={cn("w-20", viewportIsFill && "opacity-50")}
							type="number"
							min={VIEWPORT_MIN_PX}
							max={VIEWPORT_MAX_PX}
							placeholder="—"
							disabled={viewportIsFill}
							value={draftDims.width}
							onChange={(event) =>
								setDraft({ ...draftDims, width: event.target.value })
							}
							onBlur={commitViewportDims}
							onKeyDown={commitOnEnter}
							aria-label="Viewport width"
						/>
						<span className="text-xs text-muted-foreground">×</span>
						<Input
							className={cn("w-20", viewportIsFill && "opacity-50")}
							type="number"
							min={VIEWPORT_MIN_PX}
							max={VIEWPORT_MAX_PX}
							placeholder="—"
							disabled={viewportIsFill}
							value={draftDims.height}
							onChange={(event) =>
								setDraft({ ...draftDims, height: event.target.value })
							}
							onBlur={commitViewportDims}
							onKeyDown={commitOnEnter}
							aria-label="Viewport height"
						/>
						<span className="text-xs text-muted-foreground">px</span>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
