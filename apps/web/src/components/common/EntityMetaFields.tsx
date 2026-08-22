import type { EntityMetaDraft } from "@hoardodile/schemas"
import { MAX_INTRO_LENGTH, MAX_NAME_LENGTH } from "@hoardodile/schemas"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { Switch } from "@hoardodile/ui/components/switch"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { Pin } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { ColorPicker } from "@/components/common/ColorPicker"

export type EntityMetaFieldsProps = {
	readonly value: EntityMetaDraft
	readonly onChange: (patch: Partial<EntityMetaDraft>) => void
	readonly maxNameLength?: number
	readonly disabled?: boolean
	readonly testIdPrefix?: string
	readonly nameTestId?: string
	readonly showIntro?: boolean
	readonly showPinned?: boolean
}

/**
 * Shared create/edit fields for custom-tab entities: name, intro, color,
 * pinned. Used by collections, traits, relationship types, categories, and
 * tags.
 */
export function EntityMetaFields(props: EntityMetaFieldsProps) {
	const {
		value,
		onChange,
		maxNameLength = MAX_NAME_LENGTH,
		disabled,
		testIdPrefix,
		nameTestId,
		showIntro = true,
		showPinned = true,
	} = props
	const { t } = useTranslation()

	const nameInputId =
		testIdPrefix !== undefined ? `${testIdPrefix}-name` : "entity-meta-name"
	const introInputId =
		testIdPrefix !== undefined ? `${testIdPrefix}-intro` : "entity-meta-intro"
	const introTestId =
		testIdPrefix !== undefined ? `${testIdPrefix}-intro` : undefined
	const colorTestId =
		testIdPrefix !== undefined ? `${testIdPrefix}-color` : undefined
	const pinnedId =
		testIdPrefix !== undefined ? `${testIdPrefix}-pinned` : "entity-meta-pinned"

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1.5">
				<Label
					htmlFor={nameInputId}
					className="text-xs font-normal text-muted-foreground"
				>
					{t("entityMeta.nameLabel")}
				</Label>
				<Input
					id={nameInputId}
					value={value.name}
					onChange={(e) => onChange({ name: e.target.value })}
					placeholder={t("entityMeta.namePlaceholder")}
					maxLength={maxNameLength}
					disabled={disabled}
					data-testid={nameTestId}
					autoComplete="off"
				/>
			</div>
			{showIntro ? (
				<div className="flex flex-col gap-1.5">
					<Label
						htmlFor={introInputId}
						className="text-xs font-normal text-muted-foreground"
					>
						{t("entityMeta.introLabel")}
					</Label>
					<Textarea
						id={introInputId}
						rows={3}
						value={value.intro}
						onChange={(e) => onChange({ intro: e.target.value })}
						placeholder={t("entityMeta.introPlaceholder")}
						maxLength={MAX_INTRO_LENGTH}
						disabled={disabled}
						data-testid={introTestId}
						autoComplete="off"
					/>
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs font-normal text-muted-foreground">
					{t("entityMeta.colorLabel")}
				</Label>
				<ColorPicker
					value={value.color}
					onChange={(color) => onChange({ color })}
					placeholder={t("entityMeta.colorPlaceholder")}
					testId={colorTestId}
				/>
			</div>
			{showPinned ? (
				<label
					htmlFor={pinnedId}
					className="flex items-center justify-between text-xs text-secondary-foreground"
				>
					<span className="flex items-center gap-2">
						<Pin
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden
						/>
						{t("entityMeta.pinned")}
					</span>
					<Switch
						id={pinnedId}
						checked={value.pinned}
						onCheckedChange={(pinned) => onChange({ pinned })}
						disabled={disabled}
						data-testid={pinnedId}
					/>
				</label>
			) : null}
		</div>
	)
}
