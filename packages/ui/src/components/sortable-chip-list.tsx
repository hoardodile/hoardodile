import { closestCorners, DndContext } from "@dnd-kit/core"
import {
	rectSortingStrategy,
	SortableContext,
	type SortingStrategy,
} from "@dnd-kit/sortable"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type SortableChipListProps<T extends { readonly id: string }> = {
	readonly items: readonly T[]
	readonly renderItem: (item: T) => ReactNode
	readonly sensors: ReturnType<typeof import("@dnd-kit/core").useSensors>
	readonly onDragEnd: (event: import("@dnd-kit/core").DragEndEvent) => void
	readonly strategy?: SortingStrategy
	readonly empty?: ReactNode
	readonly className?: string
	readonly listClassName?: string
}

/**
 * Encapsulates the canonical DnD chip list used by management panels:
 * `DndContext` + `SortableContext` with `closestCorners` and
 * `rectSortingStrategy`.
 */
export function SortableChipList<T extends { readonly id: string }>(
	props: SortableChipListProps<T>,
): ReactNode {
	if (props.items.length === 0) {
		return props.empty ?? null
	}

	return (
		<div className={props.className}>
			<DndContext
				sensors={props.sensors}
				collisionDetection={closestCorners}
				onDragEnd={props.onDragEnd}
			>
				<SortableContext
					items={props.items.map((item) => item.id)}
					strategy={props.strategy ?? rectSortingStrategy}
				>
					<div
						className={cn(
							"flex flex-wrap items-center gap-1.5",
							props.listClassName,
						)}
					>
						{props.items.map((item) => props.renderItem(item))}
					</div>
				</SortableContext>
			</DndContext>
		</div>
	)
}
