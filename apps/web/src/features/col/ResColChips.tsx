import type { ResCollectionChip } from "@hoardodile/schemas"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { QueryStateView } from "@hoardodile/ui/components/query-state-view"
import { ScrollArea } from "@hoardodile/ui/components/scroll-area"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { TagChipLink } from "@/features/tags/TagChipLink"
import { ResThumb } from "../res/components/ResThumb"
import { colResourceIdsQueryOptions } from "./api"

export type ResCollectionChipsProps = {
	readonly collections: readonly ResCollectionChip[]
}

/**
 * Renders one chip per collection in `collections`. Each chip is a
 * popover trigger that lists sibling resources in that collection.
 * Renders nothing when the resource is not in any collection.
 *
 * Collections are pre-resolved on the server and embedded in the
 * `ResCard` payload, so this component does not fire a per-card
 * query.
 */
export function ResCollectionChips(props: ResCollectionChipsProps) {
	const { collections } = props
	if (collections.length === 0) return null
	return (
		<div className="mt-0.5 flex flex-wrap gap-1.5">
			{collections.map((c) => (
				<ColChip key={c.id} colId={c.id} name={c.name} color={c.color} />
			))}
		</div>
	)
}

type ColChipProps = {
	readonly colId: string
	readonly name: string
	readonly color: string
}

function ColChip(props: ColChipProps) {
	const { colId, name, color } = props
	const { t } = useTranslation()
	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						type="button"
						className="block border-0 bg-transparent p-0"
						aria-label={t("collections.chip.openLabel", { name })}
						data-testid={`collection-chip-${colId}`}
					>
						<TagChipLink
							id={colId}
							type="resource"
							name={name}
							color={color}
							link={false}
						/>
					</button>
				}
			/>
			<PopoverContent className="w-72 p-2">
				<ColResourcesList colId={colId} name={name} />
			</PopoverContent>
		</Popover>
	)
}

type ColResourcesListProps = {
	readonly colId: string
	readonly name: string
}

function ColResourcesList(props: ColResourcesListProps) {
	const { colId, name } = props
	const { t } = useTranslation()
	const listQuery = useQuery(colResourceIdsQueryOptions(colId))
	return (
		<div className="flex flex-col gap-2">
			<div className="px-1 text-sm font-medium" title={name}>
				{name}
			</div>
			<QueryStateView
				result={listQuery}
				isEmpty={isEmptyIdList}
				loading={
					<div className="space-y-2 p-2">
						<p className="text-xs text-muted-foreground">
							{t("common.loading")}
						</p>
						<Skeleton className="h-16 w-full" />
					</div>
				}
				empty={
					<div className="px-1 text-xs text-muted-foreground">
						{t("collections.popover.empty")}
					</div>
				}
			>
				{(resIds) => (
					<ScrollArea className="max-h-72">
						<ul className="grid grid-cols-3 gap-1 pr-2">
							{resIds.map((rid) => (
								<li
									key={rid}
									className="block overflow-hidden rounded-md border bg-muted"
									data-testid={`collection-popover-resource-${rid}`}
								>
									<ResThumb
										resId={rid}
										className="aspect-square w-full object-cover"
										maxWidth={80}
										maxHeight={80}
									/>
								</li>
							))}
						</ul>
					</ScrollArea>
				)}
			</QueryStateView>
		</div>
	)
}

function isEmptyIdList(ids: readonly string[]): boolean {
	return ids.length === 0
}
