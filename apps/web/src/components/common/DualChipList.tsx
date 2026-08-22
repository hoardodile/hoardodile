import { GroupLabel } from "@hoardodile/ui/components/group-label"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { TagChip, type TagChipSize } from "@/features/tags/TagChip"

export type DualChipItem = {
	readonly id: string
	readonly label: ReactNode
	readonly icon?: ReactNode
	readonly color?: string
	readonly selected?: boolean
}

export type DualChipListProps = {
	readonly items: readonly DualChipItem[]
	/** Structured picks (trait rows) rendered above the Selected block. */
	readonly selectedRows?: ReactNode
	/**
	 * Extra content rendered inside the Selected block below the chips —
	 * e.g. the plugin facets, which belong to the selected plugin.
	 */
	readonly selectedExtra?: ReactNode
	/** Chip height tier — `md` for the filterer facets. */
	readonly size?: TagChipSize
	readonly onToggle: (id: string) => void
}

/**
 * Dual-chip list for flat facets: the same Selected-over-Available
 * anatomy as the tag picker, minus the category row. Selected items sit
 * in their own block, a hairline separates the two, and the Available
 * cloud scrolls so long lists never stretch the rail.
 */
export function DualChipList(props: DualChipListProps) {
	const { items, selectedRows, selectedExtra, size, onToggle } = props
	const { t } = useTranslation()
	const selected = items.filter((item) => item.selected === true)
	const available = items.filter((item) => item.selected !== true)
	const hasSelection = selected.length > 0 || selectedRows !== undefined

	return (
		<div className="mt-1 flex flex-col gap-2">
			{selectedRows}
			{selected.length > 0 ? (
				<div>
					<GroupLabel>{t("common.selected")}</GroupLabel>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{selected.map((item) => (
							<TagChip
								key={item.id}
								color={item.color ?? ""}
								icon={item.icon}
								size={size}
								active
								onClick={() => onToggle(item.id)}
							>
								{item.label}
							</TagChip>
						))}
					</div>
					{selectedExtra}
				</div>
			) : null}
			{hasSelection && available.length > 0 ? (
				<div className="h-px bg-border" />
			) : null}
			{available.length > 0 ? (
				<div>
					{hasSelection ? (
						<GroupLabel>{t("common.available")}</GroupLabel>
					) : null}
					<div className="strip-scroll mt-1.5 flex max-h-36 flex-wrap content-start gap-1.5 overflow-y-auto">
						{available.map((item) => (
							<TagChip
								key={item.id}
								color={item.color ?? ""}
								icon={item.icon}
								size={size}
								onClick={() => onToggle(item.id)}
							>
								{item.label}
							</TagChip>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}
