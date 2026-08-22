import type { ResCollection } from "@hoardodile/schemas"
import { comparePinnedPositionName } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { QueryStateView } from "@hoardodile/ui/components/query-state-view"
import { ScrollArea } from "@hoardodile/ui/components/scroll-area"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AddGridPill } from "@/components/common/AddGridPill"
import { EntityMetaFields } from "@/components/common/EntityMetaFields"
import { matchesNameQuery } from "@/components/common/entityFilter"
import { SearchField } from "@/components/common/SearchField"
import { TagChip } from "@/features/tags/TagChip"
import { useToastMutation } from "@/hooks/useToastMutation"
import {
	buildEntityMetaCreatePayload,
	emptyEntityMetaDraft,
} from "@/lib/entityMetaDraft"
import {
	colKeys,
	colListQueryOptions,
	createCollectionMutation,
	invalidateCollections,
} from "./api"

export type ColPickerProps = {
	readonly value: readonly string[]
	readonly onChange: (next: readonly string[]) => void
}

const EMPTY_DRAFT = emptyEntityMetaDraft({ pinned: true })

/**
 * Multi-select collection picker rendered as selectable chips.
 * Collections are sorted by `pinned` then `position` then `name`.
 * A trailing "New collection" button opens a dialog with the full
 * create form, matching the edit dialog field set.
 */
export function ColPicker(props: ColPickerProps) {
	const { value, onChange } = props
	const { t } = useTranslation()
	const listQuery = useQuery(colListQueryOptions())
	const [query, setQuery] = useState("")
	return (
		<div className="flex flex-col gap-3 rounded-lg bg-card">
			<SearchField
				value={query}
				onCommit={setQuery}
				placeholder={t("collections.picker.searchPlaceholder")}
				className="w-full"
				testId="collection-picker-search"
			/>
			<QueryStateView
				result={listQuery}
				loading={
					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							{t("common.loading")}
						</p>
						<Skeleton className="h-8 w-full" />
						<Skeleton className="h-8 w-4/5" />
					</div>
				}
			>
				{(collections) => (
					<ColPickerList
						collections={collections}
						value={value}
						onChange={onChange}
						query={query}
					/>
				)}
			</QueryStateView>
			<AddCollectionButton value={value} onChange={onChange} />
		</div>
	)
}

type ColPickerListProps = {
	readonly collections: readonly ResCollection[]
	readonly value: readonly string[]
	readonly onChange: (next: readonly string[]) => void
	readonly query: string
}

function ColPickerList(props: ColPickerListProps) {
	const { collections, value, onChange, query } = props
	const sorted = [...collections]
		.sort(comparePinnedPositionName)
		.filter((c) => matchesNameQuery(c.name, query))
	if (sorted.length === 0) {
		return null
	}
	const selected = new Set(value)
	return (
		<ScrollArea className="max-h-64 pr-2">
			<div className="flex flex-wrap gap-1.5">
				{sorted.map((c) => {
					const active = selected.has(c.id)
					const title =
						c.intro !== "" && c.intro !== undefined
							? `${c.name} — ${c.intro}`
							: c.name
					return (
						<TagChip
							key={c.id}
							active={active}
							color={c.color}
							onClick={() => toggle(value, c.id, onChange)}
							title={title}
							data-testid={`collection-picker-chip-${c.id}`}
						>
							{c.name}
						</TagChip>
					)
				})}
			</div>
		</ScrollArea>
	)
}

type AddCollectionButtonProps = {
	readonly value: readonly string[]
	readonly onChange: (next: readonly string[]) => void
}

function AddCollectionButton(props: AddCollectionButtonProps) {
	const { value, onChange } = props
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState(EMPTY_DRAFT)

	const createM = useToastMutation({
		...createCollectionMutation(),
		invalidate: async (qc, created) => {
			setDraft(EMPTY_DRAFT)
			setOpen(false)
			qc.setQueryData(colKeys.all, (prev: unknown) => {
				if (!Array.isArray(prev)) return prev
				if (prev.some((c: { id: string }) => c.id === created.id)) return prev
				return [...prev, created]
			})
			onChange([...value, created.id])
			await invalidateCollections(qc)
		},
	})

	function submit() {
		const payload = buildEntityMetaCreatePayload(draft)
		if (payload === undefined || createM.isPending) return
		createM.mutate(payload)
	}

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => setOpen(false)}
				disabled={createM.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				disabled={draft.name.trim().length === 0 || createM.isPending}
				onClick={submit}
				data-testid="collection-picker-create-submit"
			>
				{t("collections.picker.quickCreate")}
			</Button>
		</>
	)

	return (
		<>
			<AddGridPill
				label={t("me.custom.entity.collection")}
				onClick={() => setOpen(true)}
				testId="collection-picker-open-create"
			/>
			<AppDialog
				open={open}
				onOpenChange={setOpen}
				title={t("collections.panel.addDialogTitle")}
				footer={footer}
			>
				<div>
					<EntityMetaFields
						value={draft}
						onChange={(patch) => setDraft({ ...draft, ...patch })}
						disabled={createM.isPending}
						testIdPrefix="collection-picker-create"
					/>
				</div>
			</AppDialog>
		</>
	)
}

function toggle(
	value: readonly string[],
	id: string,
	onChange: (next: readonly string[]) => void,
): void {
	if (value.includes(id)) {
		onChange(value.filter((v) => v !== id))
	} else {
		onChange([...value, id])
	}
}
