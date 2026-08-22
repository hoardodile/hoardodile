import { FontPicker as FontPickerShell } from "@hoardodile/ui/components/font-picker"
import { useTranslation } from "react-i18next"
import { TagChip } from "@/features/tags/TagChip"
import {
	buildFontFamily,
	EXTRA_FONT_TAGS,
	getPresetByIdOrName,
	loadPresetCss,
	PRESET_FONTS,
	SYSTEM_FONT_TAGS,
} from "@/lib/fonts"

export type FontPickerProps = {
	readonly value: readonly string[]
	readonly onChange: (value: string[]) => void
	/**
	 * Controlled "inherit app font" state. When `onInheritChange` is
	 * provided the picker renders an inherit switch; the switch only
	 * decides whether the chosen stack is used (implementation-level
	 * fallback) — the picker itself always stays visible and editable,
	 * so the user can keep a stack ready while inheriting.
	 */
	readonly inherit?: boolean
	readonly onInheritChange?: (checked: boolean) => void
	readonly inheritedFonts?: readonly string[]
	readonly inheritedFamily?: string
	readonly "data-testid"?: string
	readonly "aria-label"?: string
}

/**
 * The app-wired {@link FontPicker} shell from
 * `@hoardodile/ui/components/font-picker`: the font registry (presets,
 * system/extra tags, CSS loading) and the localized labels live here;
 * the picker itself stays generic.
 */
export function FontPicker(props: FontPickerProps) {
	const { t } = useTranslation()
	const {
		value,
		onChange,
		inherit = false,
		onInheritChange,
		inheritedFonts,
		inheritedFamily,
		"data-testid": testId,
		"aria-label": ariaLabel,
	} = props

	function resolveFont(name: string): string {
		const trimmed = name.trim()
		const preset = getPresetByIdOrName(trimmed)
		if (preset) {
			if (!value.includes(preset.id) && !value.includes(preset.name)) {
				loadPresetCss(preset.id)
			}
			return preset.id
		}
		if (!value.includes(trimmed)) loadPresetCss(trimmed)
		return trimmed
	}

	function resolveEntry(name: string): { label: string; family?: string } {
		const preset = getPresetByIdOrName(name)
		if (preset) {
			return {
				label: t(preset.i18nKey, { defaultValue: preset.name }),
				family: preset.name,
			}
		}
		return { label: name }
	}

	function toggleWebPreset(presetId: string, presetName: string) {
		const idx = value.findIndex((v) => v === presetId || v === presetName)
		if (idx !== -1) {
			onChange(value.filter((_, i) => i !== idx))
		} else {
			loadPresetCss(presetId)
			onChange([...value, presetId])
		}
	}

	function toggleTag(tag: string) {
		const idx = value.indexOf(tag)
		if (idx !== -1) {
			onChange(value.filter((_, i) => i !== idx))
		} else {
			loadPresetCss(tag)
			onChange([...value, tag])
		}
	}

	const presetTags = (
		<>
			{PRESET_FONTS.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{PRESET_FONTS.map((p) => {
						const active = value.includes(p.id) || value.includes(p.name)
						return (
							<TagChip
								key={p.id}
								size="md"
								active={active}
								onClick={() => toggleWebPreset(p.id, p.name)}
							>
								<span style={{ fontFamily: p.name }}>
									{t(p.i18nKey, {
										defaultValue: p.name,
									})}
								</span>
							</TagChip>
						)
					})}
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				{SYSTEM_FONT_TAGS.map((tag) => {
					const active = value.includes(tag)
					return (
						<TagChip
							key={tag}
							size="md"
							active={active}
							onClick={() => toggleTag(tag)}
						>
							<span style={{ fontFamily: tag }}>{tag}</span>
						</TagChip>
					)
				})}
			</div>
			<div className="flex flex-wrap gap-2">
				{EXTRA_FONT_TAGS.map((tag) => {
					const active = value.includes(tag)
					return (
						<TagChip
							key={tag}
							size="md"
							active={active}
							onClick={() => toggleTag(tag)}
						>
							<span style={{ fontFamily: tag }}>{tag}</span>
						</TagChip>
					)
				})}
			</div>
		</>
	)

	return (
		<FontPickerShell
			value={value}
			onChange={onChange}
			inherit={inherit}
			onInheritChange={onInheritChange}
			inheritedFonts={inheritedFonts}
			inheritedFamily={inheritedFamily}
			presetTags={presetTags}
			resolveFont={resolveFont}
			resolveEntry={resolveEntry}
			previewFamily={buildFontFamily(value)}
			data-testid={testId}
			aria-label={ariaLabel}
			labels={{
				inherit: t("font.inherit"),
				inheritedHint: t("font.inheritedHint"),
				addCustom: t("font.addCustom"),
				selected: t("font.selected"),
				description: t("font.description"),
			}}
		/>
	)
}
