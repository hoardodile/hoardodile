import { ColorPicker as ColorPickerShell } from "@hoardodile/ui/components/color-picker"
import { useTranslation } from "react-i18next"
import { jsonCodec } from "@/features/prefs"
import { TagChip } from "@/features/tags/TagChip"
import { usePrefSync } from "@/hooks/usePrefSync"
import { loose } from "@/i18n"
import {
	DEFAULT_COLOR_PRESETS,
	isSpecialTagStyle,
	TAG_SPECIAL_STYLES,
} from "@/lib/colors"
import { prefKeys } from "@/lib/keys"

export type ColorPickerProps = {
	readonly value: string
	readonly onChange: (color: string) => void
	readonly specialStyles?: boolean
	readonly placeholder?: string
	readonly testId?: string
}

const MAX_USER_PRESETS = 20

/**
 * The app-wired {@link ColorPicker} shell from
 * `@hoardodile/ui/components/color-picker`: my-presets persistence
 * (`prefSync`), the tag-chip special-style surfaces and the localized
 * labels live here; the picker itself stays generic.
 */
export function ColorPicker(props: ColorPickerProps) {
	const { value, onChange, specialStyles = true, placeholder, testId } = props
	const { t } = useTranslation()
	const [userPresets, setUserPresets] = usePrefSync<string[]>(
		prefKeys.colorPresets,
		[],
		jsonCodec<string[]>(),
	)

	function addPreset() {
		if (value === "" || isSpecialTagStyle(value)) return
		const normalized = value.toLowerCase()
		const all = [...DEFAULT_COLOR_PRESETS, ...userPresets].map((c) =>
			c.toLowerCase(),
		)
		if (all.includes(normalized)) return
		const next = [...userPresets, value]
		if (next.length > MAX_USER_PRESETS) {
			next.shift()
		}
		setUserPresets(next)
	}

	return (
		<ColorPickerShell
			value={value}
			onChange={onChange}
			presets={DEFAULT_COLOR_PRESETS}
			userPresets={userPresets}
			onAddPreset={addPreset}
			onRemovePreset={(index) =>
				setUserPresets(userPresets.filter((_, i) => i !== index))
			}
			specialStyles={specialStyles ? TAG_SPECIAL_STYLES : []}
			renderSpecialStyle={
				specialStyles
					? (style, active, onPick) => (
							<TagChip
								color={style}
								active={active}
								onClick={onPick}
								title={loose(t)(`categories.panel.specialStyle.${style}`)}
							>
								{loose(t)(`categories.panel.specialStyle.${style}`)}
							</TagChip>
						)
					: undefined
			}
			placeholder={placeholder}
			testId={testId}
			labels={{
				clear: t("common.colorPicker.clear"),
				addPreset: t("common.colorPicker.addPreset"),
				removePresetAria: (color) =>
					t("common.colorPicker.removePresetAria", { color }),
				customSwatch: t("common.colorPicker.customSwatch"),
			}}
		/>
	)
}
