import { Badge } from "@hoardodile/ui/components/badge"
import { Button } from "@hoardodile/ui/components/button"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Add } from "@hoardodile/ui/icons/actions"
import { Cross } from "@hoardodile/ui/icons/marks"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { resKeys } from "@/features/res/api"
import { ResSelectorDialog } from "@/features/res/components/ResSelectorDialog"
import { trpcQuery } from "@/trpc/factory"

export type ResChipsPickerProps = {
	readonly ids: readonly string[]
	/** Edit handler. Omit for view-only mode (no `+` / `×` controls). */
	readonly onChange?: (ids: readonly string[]) => void
	/** Ids that the selector dialog must never offer (e.g. the host resource). */
	readonly excludeIds?: readonly string[]
	/** Ids that cannot be removed via chip `×` or selector deselect. */
	readonly lockedIds?: readonly string[]
	readonly selectorTitle?: string
	readonly emptyHint?: string
	readonly className?: string
	readonly testId?: string
}

/**
 * Chip row of resources. Edit-mode (`onChange` provided) wires a trailing
 * `+` trigger to {@link ResSelectorDialog} in multi-select mode,
 * pre-populated with the current ids — mirroring `CharChipsPicker`.
 *
 * Lightweight by design: each chip resolves its display name on demand
 * via the cached `resource.detail` query.
 */
function mergeLockedIds(
	next: readonly string[],
	lockedIds: readonly string[] | undefined,
): readonly string[] {
	const locked = lockedIds ?? []
	if (locked.length === 0) return next
	const extras = next.filter((id) => !locked.includes(id))
	return [...locked, ...extras]
}

export function ResChipsPicker(props: ResChipsPickerProps) {
	const {
		ids,
		onChange,
		excludeIds,
		lockedIds,
		selectorTitle,
		emptyHint,
		className,
		testId,
	} = props
	const [pickerOpen, setPickerOpen] = useState(false)
	const { t } = useTranslation()

	function handleRemove(id: string) {
		if (onChange === undefined) return
		if (lockedIds?.includes(id)) return
		onChange(ids.filter((existing) => existing !== id))
	}

	function handleConfirm(next: readonly string[]) {
		if (onChange === undefined) return
		onChange(mergeLockedIds(next, lockedIds))
		setPickerOpen(false)
	}

	const isEmpty = ids.length === 0
	return (
		<div
			className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}
			data-testid={testId}
		>
			{ids.map((id) => {
				const isLocked = lockedIds?.includes(id) ?? false
				return (
					<ResChip
						key={id}
						resId={id}
						onRemove={
							onChange === undefined || isLocked
								? undefined
								: () => handleRemove(id)
						}
						testId={testId !== undefined ? `${testId}-chip-${id}` : undefined}
					/>
				)
			})}
			{isEmpty && onChange === undefined && emptyHint !== undefined ? (
				<Badge variant="outline" className="rounded-md text-muted-foreground">
					{emptyHint}
				</Badge>
			) : null}
			{onChange !== undefined ? (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => setPickerOpen(true)}
					aria-label={t("messages.linkResources")}
					data-testid={testId !== undefined ? `${testId}-add` : undefined}
				>
					<Add className="size-3.5" />
					{t("me.custom.link")}
				</Button>
			) : null}
			{onChange !== undefined ? (
				<ResSelectorDialog
					open={pickerOpen}
					mode="multi"
					title={selectorTitle}
					initialSelected={ids}
					excludeIds={excludeIds}
					lockedIds={lockedIds}
					onConfirm={handleConfirm}
					onOpenChange={setPickerOpen}
					confirmTestId={
						testId !== undefined ? `${testId}-selector-confirm` : undefined
					}
				/>
			) : null}
		</div>
	)
}

type ResChipProps = {
	readonly resId: string
	readonly onRemove?: () => void
	readonly testId?: string
}

function ResChip(props: ResChipProps) {
	const { resId, onRemove, testId } = props
	const { t } = useTranslation()
	return (
		<Badge
			variant="secondary"
			className="h-7 rounded-md"
			data-testid={testId}
			render={
				onRemove === undefined ? (
					<Link to="/resources/$id" params={{ id: resId }} />
				) : undefined
			}
		>
			<ResChipName resId={resId} />
			{onRemove !== undefined ? (
				<button
					type="button"
					aria-label={t("common.removeAria")}
					onClick={onRemove}
					className="text-muted-foreground hover:text-foreground"
					data-testid={testId !== undefined ? `${testId}-remove` : undefined}
				>
					<Cross className="h-3 w-3" />
				</button>
			) : null}
		</Badge>
	)
}

function ResChipName(props: { readonly resId: string }) {
	// Use trpcQuery directly via resource detail; cheap because cached
	// alongside resource list responses.
	const detail = useQuery({
		queryKey: resKeys.detail(props.resId),
		queryFn: () => trpcQuery("resource", "detail", { id: props.resId }),
		staleTime: 5_000,
	})
	if (detail.isLoading) {
		return <Skeleton className="h-3 w-16" />
	}
	const name = detail.data?.name ?? props.resId
	return <span className="max-w-32 truncate">{name}</span>
}
