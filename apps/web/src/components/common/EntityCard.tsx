import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	HamburgerMenu,
	MenuDots,
	Pen,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { forwardRef, type ReactNode, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { DeleteEntityButtonHandle } from "./DeleteEntityButton"

export type EntityCardProps = {
	readonly item: { readonly id: string }
	readonly reorderMode: boolean
	readonly dragDisabled: boolean
	/** The entity's chip preview — the only filled element on the card. */
	readonly chip: ReactNode
	/** The bottom caption line: kind, counts, state. */
	readonly meta: ReactNode
	readonly testIdPrefix: string
	readonly triggerTestId?: string
	readonly editMenuTestId?: string
	readonly deleteMenuTestId?: string
	readonly renderEditDialog: (controls: {
		readonly open: boolean
		readonly onOpenChange: (open: boolean) => void
	}) => ReactNode
	readonly renderDeleteButton: (
		ref: React.RefObject<DeleteEntityButtonHandle | null>,
	) => ReactNode
	readonly extraMenuItems?: ReactNode
}

/**
 * Entity cell: the management unit on every custom-page grid.
 * Borderless and flat in spirit, wrapped in a hairline so the grid reads
 * as small cards: the top line is the chip (the only filled element, so
 * the entity's own surface carries the cell) plus the drag grip in
 * reorder mode and an always-visible More button; the bottom line is the
 * meta caption, which gets a row to itself so long words ("Unused") and
 * big counts never squeeze the pill.
 */
export const EntityCard = forwardRef<HTMLDivElement, EntityCardProps>(
	function EntityCard(props, ref) {
		const { t } = useTranslation()
		const [editOpen, setEditOpen] = useState(false)
		const [menuOpen, setMenuOpen] = useState(false)
		const deleteRef = useRef<DeleteEntityButtonHandle>(null)

		const {
			attributes,
			listeners,
			setNodeRef,
			transform,
			transition,
			isDragging,
		} = useSortable({
			id: props.item.id,
			disabled: props.dragDisabled,
			transition: null,
		})

		const style: React.CSSProperties = {
			transform: CSS.Translate.toString(transform),
			transition,
			opacity: isDragging ? 0.5 : 1,
		}

		return (
			<div
				ref={(node) => {
					setNodeRef(node)
					if (typeof ref === "function") {
						ref(node)
					} else if (ref !== null) {
						ref.current = node
					}
				}}
				style={style}
				className={cn(
					"flex flex-col gap-1 rounded-lg border border-border px-2 py-1.5",
					props.reorderMode &&
						!props.dragDisabled &&
						"cursor-grab active:cursor-grabbing",
				)}
				data-testid={`${props.testIdPrefix}-row-${props.item.id}`}
				{...attributes}
				{...listeners}
			>
				<div className="flex items-center gap-2">
					{props.reorderMode ? (
						<Icon
							icon={HamburgerMenu}
							size="sm"
							className="shrink-0 cursor-grab text-muted-foreground"
						/>
					) : null}
					<div className="min-w-0 flex-1">{props.chip}</div>
					<DropdownMenu modal={false} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-xs"
									className={cn("shrink-0", menuOpen && "bg-muted")}
									aria-label={t("me.custom.more")}
									data-testid={
										props.triggerTestId ??
										`${props.testIdPrefix}-chip-${props.item.id}`
									}
								>
									<Icon icon={MenuDots} size="sm" />
								</Button>
							}
						/>
						<DropdownMenuContent align="end" className="min-w-48">
							<DropdownMenuItem
								onClick={() => setEditOpen(true)}
								data-testid={
									props.editMenuTestId ??
									`${props.testIdPrefix}-open-edit-${props.item.id}`
								}
							>
								<Icon icon={Pen} />
								{t("common.edit")}
							</DropdownMenuItem>
							{props.extraMenuItems}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onClick={() => deleteRef.current?.beginDelete()}
								data-testid={
									props.deleteMenuTestId ??
									`${props.testIdPrefix}-delete-menu-${props.item.id}`
								}
							>
								<Icon icon={TrashBinMinimalistic} />
								{t("deleteEntity.defaultLabel")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{props.meta !== null ? (
					<span className="flex items-center gap-1.5 text-tiny tabular-nums whitespace-nowrap text-muted-foreground">
						{props.meta}
					</span>
				) : null}
				{editOpen
					? props.renderEditDialog({
							open: editOpen,
							onOpenChange: setEditOpen,
						})
					: null}
				{props.renderDeleteButton(deleteRef)}
			</div>
		)
	},
)

/** Meta caption unit — muted plain text on the card's caption line; the
    optional title rides as a hover tooltip (e.g. the relationship kind's
    full name). Icons never live here — they ride inside the chip via
    TagChip's `icon` prop, the char-search filter's pattern. */
export function Meta(props: {
	readonly text?: ReactNode
	readonly title?: string
}) {
	return (
		<span title={props.title} className="flex items-center gap-1">
			{props.text}
		</span>
	)
}
