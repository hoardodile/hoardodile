import { cn } from "@hoardodile/ui/lib/utils"
import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import type { TagGroup } from "./buildTagGroups"
import { TagChipHover } from "./TagChipHover"
import { TagChipLink } from "./TagChipLink"

export type CatTagGroupsProps = {
	readonly type: "character" | "resource"
	readonly groups: readonly TagGroup[]
	readonly categoryVariant?: "text" | "chip"
	/**
	 * Optional `data-testid` template applied to each group row. The
	 * `catId` of each group is appended with a hyphen.
	 */
	readonly testIdPrefix?: string
}

/**
 * Compact layout shared by character and resource detail pages: one row
 * per category, with the category name on the left and a horizontal,
 * non-wrapping strip of tag chips on the right. The strip becomes
 * horizontally scrollable when it overflows so that tags belonging to
 * one category never wrap onto a second visual line.
 *
 * Virtual tags (M3) — tags an entry only has through parent rules —
 * render weakened with a "virtual" marker: they are not stored on the
 * entry and cannot be removed directly.
 */
export function CatTagGroups(props: CatTagGroupsProps) {
	const { type, groups, categoryVariant = "text", testIdPrefix } = props
	const { t } = useTranslation()
	return (
		<div className="flex flex-col gap-1.5">
			{groups.map((group) => (
				<div
					key={group.catId}
					className="flex min-w-0 items-center gap-2"
					data-testid={
						testIdPrefix === undefined
							? undefined
							: `${testIdPrefix}-${group.catId}`
					}
				>
					{categoryVariant === "chip" ? (
						<>
							<TagChipLink
								id={group.catId}
								type={type}
								name={group.catName}
								color={group.catColor}
								link={false}
								className="shrink-0"
							/>
							<span className="shrink-0 text-xs text-muted-foreground">: </span>
						</>
					) : (
						<span className="shrink-0 text-xs text-muted-foreground">
							{group.catName}
						</span>
					)}
					<div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
						{group.tags.map((tag) => {
							const virtual = tag.virtual === true
							const chip = (
								<TagChipHover tagId={tag.id}>
									<TagChipLink
										id={tag.id}
										type={type}
										name={tag.name}
										color={virtual ? "" : tag.color}
										className={cn("max-w-30", virtual && "opacity-60")}
									/>
								</TagChipHover>
							)
							return virtual ? (
								<span
									key={tag.id}
									className="inline-flex items-center gap-1"
									data-testid={`virtual-tag-${tag.id}`}
								>
									{chip}
									<span className="text-tiny text-muted-foreground">
										{t("tags.virtual.label")}
									</span>
								</span>
							) : (
								<Fragment key={tag.id}>{chip}</Fragment>
							)
						})}
					</div>
				</div>
			))}
		</div>
	)
}
