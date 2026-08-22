import {
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import type {
	QueryClient,
	UseMutationOptions,
	UseMutationResult,
} from "@tanstack/react-query"
import { useState } from "react"
import { useToastMutation } from "@/hooks/useToastMutation"

/**
 * Wires up the canonical DnD reorder mutation lifecycle used by management
 * panels across the app: sensors, optimistic `orderIds` state, drag-end
 * handler with `arrayMove`, mutation wrapper that invalidates queries and
 * resets order on success, and toast on error.
 *
 * @example
 *   const { orderIds, setOrderIds, reorderMut, sensors, handleDragEnd } =
 *     useReorderMutation({
 *       mutationOptions: reorderTraitMutation(),
 *       invalidate: invalidateTraits,
 *       buildInput: (ids) => ({ ids }),
 *     })
 *   const items = applyOrderOverride(baseSorted, orderIds)
 *   // JSX:
 *   <DndContext sensors={sensors} onDragEnd={handleDragEnd(items)}>
 */
export type ReorderMutationConfig<TInput, TOutput = unknown> = {
	readonly mutationOptions: UseMutationOptions<TOutput, Error, TInput>
	readonly invalidate: (qc: QueryClient) => Promise<void>
	readonly buildInput: (ids: string[]) => TInput
	readonly errorMessageKey?: string
}

export type ReorderMutationResult<TInput, TOutput> = {
	readonly orderIds: readonly string[] | undefined
	readonly setOrderIds: (ids: readonly string[] | undefined) => void
	readonly reorderMut: UseMutationResult<TOutput, Error, TInput>
	readonly sensors: ReturnType<typeof useSensors>
	readonly handleDragEnd: (
		items: readonly { readonly id: string }[],
	) => (event: DragEndEvent) => void
}

export function useReorderMutation<TInput, TOutput = unknown>(
	config: ReorderMutationConfig<TInput, TOutput>,
): ReorderMutationResult<TInput, TOutput> {
	const [orderIds, setOrderIds] = useState<readonly string[] | undefined>(
		undefined,
	)
	const errorKey = config.errorMessageKey ?? "common.unknownError"

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	const reorderMut = useToastMutation({
		...config.mutationOptions,
		invalidate: async (qc) => {
			await config.invalidate(qc)
			setOrderIds(undefined)
		},
		errorToastKey: errorKey,
	})

	function handleDragEnd(
		items: readonly { readonly id: string }[],
	): (event: DragEndEvent) => void {
		return (event: DragEndEvent) => {
			const { active, over } = event
			if (over === null || active.id === over.id) return
			const currentIds = items.map((x) => x.id)
			const oldIndex = currentIds.indexOf(String(active.id))
			const newIndex = currentIds.indexOf(String(over.id))
			if (oldIndex < 0 || newIndex < 0) return
			const nextIds = arrayMove([...currentIds], oldIndex, newIndex)
			setOrderIds(nextIds)
			reorderMut.mutate(config.buildInput(nextIds))
		}
	}

	return { orderIds, setOrderIds, reorderMut, sensors, handleDragEnd }
}
