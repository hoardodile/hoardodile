import type { CommentSortBy } from "@hoardodile/schemas"

import { Button } from "@hoardodile/ui/components/button"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Cross } from "@hoardodile/ui/icons/marks"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import { charDetailCardQueryOptions } from "@/features/char/api"
import { CharChip } from "@/features/char/components/CharChip"
import { resDetailCardQueryOptions } from "@/features/res/api"
import type { SetPatch } from "@/hooks/useRouteSearchState"
import { commentCountLabel } from "./commentCountLabel"
import type { CommentSearchState } from "./searchState"
import { SORT_OPTIONS } from "./searchState"

export type CommentFilterBarProps = {
	readonly state: CommentSearchState
	readonly patch: SetPatch<CommentSearchState>
	/** Floor/reply totals for the page (right-aligned metadata count in
	    the filter-chips row). */
	readonly count?: { readonly floors: number; readonly replies: number }
}

export function CommentFilterBar(props: CommentFilterBarProps) {
	const { state, patch, count } = props
	const { t } = useTranslation()

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				{state.charId.length > 0 ? (
					<ActiveCharFilter
						charId={state.charId}
						onClear={() => patch({ charId: "", page: 1 })}
					/>
				) : null}
				{state.resId.length > 0 ? (
					<ActiveResourceFilter
						resId={state.resId}
						onClear={() => patch({ resId: "", page: 1 })}
					/>
				) : null}
				{count !== undefined ? (
					<CommentCountLabel floors={count.floors} replies={count.replies} />
				) : null}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<div className="min-w-[200px] flex-1">
					<SearchField
						value={state.query}
						placeholder={t("messages.searchPlaceholder")}
						testId="comments-search-input"
						onCommit={(v) => patch({ query: v, page: 1 })}
					/>
				</div>
				<DropdownSelect
					value={state.sortBy}
					onValueChange={(v) => patch({ sortBy: v as CommentSortBy, page: 1 })}
					aria-label={t("messages.sortBy")}
					options={SORT_OPTIONS.map((option) => ({
						value: option,
						label: t(`messages.sort.${option}`),
					}))}
				/>
				<label
					className="flex items-center gap-1.5 text-ui text-secondary-foreground"
					htmlFor="comments-trash"
				>
					<Checkbox
						id="comments-trash"
						checked={state.trash}
						onCheckedChange={(v) => patch({ trash: v === true, page: 1 })}
					/>
					{t("messages.trash")}
				</label>
			</div>
		</div>
	)
}

type ActiveCharFilterProps = {
	readonly charId: string
	readonly onClear: () => void
}

/** Right-aligned metadata count in the chips row ("2 threads · 1 reply");
    hidden while totals are still loading or the library is empty. */
function CommentCountLabel(props: {
	readonly floors: number
	readonly replies: number
}) {
	const { floors, replies } = props
	const { t } = useTranslation()
	const label = commentCountLabel(floors, replies, t)
	if (label.length === 0) return undefined
	return (
		<span
			className="ml-auto text-xs text-muted-foreground"
			data-testid="comments-count"
		>
			{label}
		</span>
	)
}

function ActiveCharFilter(props: ActiveCharFilterProps) {
	const { charId, onClear } = props
	const charQuery = useQuery(charDetailCardQueryOptions(charId))
	return (
		<CharChip
			charId={charId}
			character={charQuery.data}
			showName
			onRemove={onClear}
			testId="comments-clear-char-filter"
		/>
	)
}

type ActiveResourceFilterProps = {
	readonly resId: string
	readonly onClear: () => void
}

function ActiveResourceFilter(props: ActiveResourceFilterProps) {
	const { resId, onClear } = props
	const { t } = useTranslation()
	const resQuery = useQuery(resDetailCardQueryOptions(resId))
	const name = resQuery.data?.name ?? resId
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted py-0.5 pr-1.5 pl-2.5">
			<span className="min-w-0 max-w-40 truncate text-xs">{name}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-4"
				onClick={onClear}
				aria-label={t("messages.clearFilter")}
				data-testid="comments-clear-res-filter"
			>
				<Cross className="size-3" />
			</Button>
		</span>
	)
}
