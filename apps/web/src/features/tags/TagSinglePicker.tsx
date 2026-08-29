import type { CatKind, Tag } from "@hoardodile/schemas"
import { TagChip } from "@hoardodile/ui/components/tag-chip"
import { AltArrowDown } from "@hoardodile/ui/icons/registry"
import { useMemo, useState } from "react"
import { useTagList } from "./store"
import { TagPickDialog } from "./TagPickDialog"

export type TagSinglePickerProps = {
	readonly value: string
	readonly onChange: (tagId: string) => void
	/**
	 * When provided, only categories of this kind (plus `common`) are
	 * offered — mirroring `DualTagPicker`.
	 */
	readonly kind?: CatKind
	readonly placeholder: string
	readonly testId?: string
}

/**
 * Single-select tag picker for rule setup: the shared category-tag
 * picker ({@link DualTagPicker} in single mode) without sibling
 * collapse — rules must reference the real tags, not their display
 * tags. The trigger opens the shared {@link TagPickDialog}.
 */
export function TagSinglePicker(props: TagSinglePickerProps) {
	const { value, onChange, kind, placeholder, testId } = props
	const [open, setOpen] = useState(false)
	const tagsById = useTagsById()

	const selectedTag = tagsById.get(value)

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex h-chip w-fit max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs text-secondary-foreground outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent active:bg-accent data-placeholder:text-muted-foreground"
				data-placeholder={selectedTag === undefined ? true : undefined}
				data-testid={testId}
			>
				{selectedTag !== undefined ? (
					<TagChip color={selectedTag.color}>{selectedTag.name}</TagChip>
				) : (
					<span className="line-clamp-1">{placeholder}</span>
				)}
				<AltArrowDown
					className="pointer-events-none size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
			</button>
			<TagPickDialog
				open={open}
				onOpenChange={setOpen}
				kind={kind}
				onPick={onChange}
				testId={testId}
			/>
		</>
	)
}

/** Tag lookup map for the picker trigger. */
export function useTagsById(): ReadonlyMap<string, Tag> {
	const allTags = useTagList()
	return useMemo(() => new Map(allTags.map((tag) => [tag.id, tag])), [allTags])
}
