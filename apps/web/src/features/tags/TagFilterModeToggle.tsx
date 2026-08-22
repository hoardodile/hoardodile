import type { TagFilterMode } from "@hoardodile/shared"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { useTranslation } from "react-i18next"

const MODE_OPTIONS = [
	{ value: "and" as const, tKey: "tags.filterMode.and" },
	{ value: "or" as const, tKey: "tags.filterMode.or" },
	{ value: "not" as const, tKey: "tags.filterMode.not" },
	{ value: "nor" as const, tKey: "tags.filterMode.nor" },
] as const

export type TagFilterModeToggleProps = {
	readonly mode: TagFilterMode
	readonly onModeChange: (mode: TagFilterMode) => void
}

/**
 * AND / OR / NOT match-mode selector for tag-based search filters — the
 * Segmented control (All / Any / Not / Nor), one unit with the tag pick
 * below it. Lives outside `DualTagPicker` so the picker can stay reusable
 * in non-search contexts (e.g. editing a resource's tags).
 */
export function TagFilterModeToggle(props: TagFilterModeToggleProps) {
	const { mode, onModeChange } = props
	const { t } = useTranslation()

	return (
		<PillTabs
			value={mode}
			// The rail section is a flex column; without self-start the
			// track stretches and leaves an empty gap.
			className="self-start"
			onChange={(next) => {
				if (isTagFilterMode(next)) onModeChange(next)
			}}
			items={MODE_OPTIONS.map((opt) => ({
				value: opt.value,
				label: t(opt.tKey),
			}))}
		/>
	)
}

function isTagFilterMode(value: string): value is TagFilterMode {
	for (const option of MODE_OPTIONS) {
		if (option.value === value) return true
	}
	return false
}
