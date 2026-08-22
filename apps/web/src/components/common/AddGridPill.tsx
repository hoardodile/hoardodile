import { Add } from "@hoardodile/ui/icons/actions"
import { cn } from "@hoardodile/ui/lib/utils"
import { TagChip, type TagChipSize } from "@/features/tags"

/**
 * Trailing quick-add pill (the dashed add pill closing a chip strip): a
 * dashed TagChip with a plus mark that opens the panel's create dialog.
 * Rendered at the end of every picker's chip area.
 */
export function AddGridPill(props: {
	readonly label: string
	readonly onClick: () => void
	readonly testId?: string
	readonly className?: string
	/** Chip height tier — `md` for category/trait/relation/collection
	    pills, `sm` for the tag pill so it matches the tag chips. */
	readonly size?: TagChipSize
}) {
	return (
		<button
			type="button"
			className={cn("border-0 bg-transparent p-0", props.className)}
			onClick={props.onClick}
			data-testid={props.testId}
		>
			<TagChip
				border="dashed"
				size={props.size ?? "md"}
				icon={<Add className="size-3" aria-hidden />}
			>
				{props.label}
			</TagChip>
		</button>
	)
}
