import {
	type DragCancelEvent,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core"
import { useCombinedRefs } from "@dnd-kit/utilities"
import type { DocMoveItem, DocNode } from "@hoardodile/schemas"
import { toast } from "@hoardodile/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { keyBy } from "es-toolkit"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMedia } from "react-use"
import { invalidateDocuments, moveBatchMutation } from "@/features/doc"

/**
 * Where a drop will land relative to the highlighted row. `into` is
 * only valid for folders (drop nests the dragged node as the last
 * child); `before` / `after` reorder among the row's siblings.
 */
export type DropMode = "before" | "after" | "into"

type DndContextProps = {
	readonly sensors: ReturnType<typeof useSensors>
	readonly onDragStart: (event: DragStartEvent) => void
	readonly onDragMove: (event: DragMoveEvent) => void
	readonly onDragEnd: (event: DragEndEvent) => void
	readonly onDragCancel: (event: DragCancelEvent) => void
}

export type DragAPI = {
	readonly enabled: boolean
	readonly draggedId: string | undefined
	readonly hover: { readonly id: string; readonly mode: DropMode } | undefined
	/** Spread onto the tree's wrapping `<DndContext>`. */
	readonly contextProps: DndContextProps
}

export type RowDndAPI = {
	readonly setNodeRef: (node: HTMLElement | null) => void
	readonly listeners: ReturnType<typeof useDraggable>["listeners"]
	readonly attributes: ReturnType<typeof useDraggable>["attributes"]
	readonly isDragging: boolean
}

const DESKTOP_DRAG_QUERY = "(min-width: 768px) and (pointer: fine)"

/**
 * Manage drag-and-drop state for the document tree and commit moves
 * through the existing `document.moveBatch` mutation. Backed by
 * `@dnd-kit/core` so keyboard navigation and touch sensors come for
 * free; disabled outside the
 * `(min-width: 768px) and (pointer: fine)` viewport so phones / tablets
 * never see drag affordances. Additionally gated by an opt-in
 * `editMode` flag so users do not accidentally rearrange siblings
 * while merely scrolling the tree.
 */
export function useDocumentDragDrop(
	nodes: readonly DocNode[],
	editMode: boolean,
): DragAPI {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const isDesktop = useMedia(DESKTOP_DRAG_QUERY, false)
	const [draggedId, setDraggedId] = useState<string | undefined>(undefined)
	const [hover, setHover] = useState<
		{ readonly id: string; readonly mode: DropMode } | undefined
	>(undefined)
	// `handleDragEnd` is invoked synchronously by dnd-kit after the last
	// `handleDragMove`; React state updates haven't necessarily flushed
	// yet, so mirror `hover` into a ref to read the latest mode at commit.
	const hoverRef = useRef<
		{ readonly id: string; readonly mode: DropMode } | undefined
	>(undefined)
	function publishHover(
		next: { readonly id: string; readonly mode: DropMode } | undefined,
	) {
		hoverRef.current = next
		setHover(next)
	}
	const startYRef = useRef(0)

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor),
	)

	const moveMut = useMutation({
		...moveBatchMutation(),
		onSuccess: async () => {
			await invalidateDocuments(qc)
		},
		onError: (err) =>
			toast.add({
				title: err.message || t("documents.toast.moveFailed"),
				type: "error",
			}),
	})

	function handleDragStart(event: DragStartEvent) {
		setDraggedId(String(event.active.id))
		publishHover(undefined)
		const evt = event.activatorEvent
		startYRef.current = evt instanceof PointerEvent ? evt.clientY : 0
	}

	function handleDragMove(event: DragMoveEvent) {
		const dragged = String(event.active.id)
		const over = event.over
		if (over === null) {
			publishHover(undefined)
			return
		}
		const overId = String(over.id)
		if (overId === dragged || isAncestor(nodes, dragged, overId)) {
			publishHover(undefined)
			return
		}
		const isFolder = over.data.current?.isFolder === true
		const rect = over.rect
		const pointerY = startYRef.current + event.delta.y
		const offset = pointerY - rect.top
		const third = rect.height / 3
		const mode: DropMode = isFolder
			? offset < third
				? "before"
				: offset > rect.height - third
					? "after"
					: "into"
			: offset < rect.height / 2
				? "before"
				: "after"
		const prev = hoverRef.current
		if (prev?.id === overId && prev.mode === mode) return
		publishHover({ id: overId, mode })
	}

	function handleDragEnd(event: DragEndEvent) {
		const dragged = String(event.active.id)
		const current = hoverRef.current
		setDraggedId(undefined)
		publishHover(undefined)
		if (current === undefined) return
		if (isAncestor(nodes, dragged, current.id)) return
		const moves = computeMoveBatch(nodes, dragged, current.id, current.mode)
		if (moves.length === 0) return
		moveMut.mutate({ moves: moves.slice() })
	}

	function handleDragCancel(_event: DragCancelEvent) {
		setDraggedId(undefined)
		publishHover(undefined)
	}

	return {
		enabled: isDesktop && editMode,
		draggedId,
		hover,
		contextProps: {
			sensors,
			onDragStart: handleDragStart,
			onDragMove: handleDragMove,
			onDragEnd: handleDragEnd,
			onDragCancel: handleDragCancel,
		},
	}
}

/**
 * Per-row dnd integration. Combines a draggable handle with a droppable
 * target so each row is both source and destination. Returns a single
 * `setNodeRef` to attach to the row's outer element.
 */
export function useTreeRowDnd(id: string, isFolder: boolean): RowDndAPI {
	const drag = useDraggable({ id, data: { isFolder } })
	const drop = useDroppable({ id, data: { isFolder } })
	const setNodeRef = useCombinedRefs(drag.setNodeRef, drop.setNodeRef)
	return {
		setNodeRef,
		listeners: drag.listeners,
		attributes: drag.attributes,
		isDragging: drag.isDragging,
	}
}

/** Cycle guard: prevent moving a node into one of its own descendants. */
function isAncestor(
	nodes: readonly DocNode[],
	ancestorId: string,
	descendantId: string,
): boolean {
	const byId = keyBy(nodes, (n) => n.id)
	let cursor: string | undefined = descendantId
	while (cursor !== undefined) {
		if (cursor === ancestorId) return true
		cursor = byId[cursor]?.parentId
	}
	return false
}

/**
 * Resolve a drag drop into a minimal `moveBatch` payload by repacking
 * the affected sibling list with sequential positions; only entries
 * whose parentId or position actually changed are emitted.
 */
function computeMoveBatch(
	nodes: readonly DocNode[],
	draggedId: string,
	targetId: string,
	mode: DropMode,
): readonly DocMoveItem[] {
	const byId = keyBy(nodes, (n) => n.id)
	const dragged = byId[draggedId]
	const target = byId[targetId]
	if (dragged === undefined || target === undefined) return []
	const newParentId =
		mode === "into" ? targetId : (target.parentId ?? undefined)
	const siblings = nodes
		.filter((n) => n.parentId === newParentId && n.id !== draggedId)
		.slice()
		.sort((a, b) => b.position - a.position || b.createdAt - a.createdAt)
	let insertAt = siblings.length
	if (mode !== "into") {
		const idx = siblings.findIndex((n) => n.id === targetId)
		insertAt = mode === "before" ? idx : idx + 1
	}
	const reordered = [
		...siblings.slice(0, insertAt),
		dragged,
		...siblings.slice(insertAt),
	]
	const moves: DocMoveItem[] = []
	// Visual list is sorted descending by position, so the topmost row
	// owns the highest position number. Walk the repacked list back-to-front
	// to assign positions 0..N-1 from the bottom of the visual list up.
	const total = reordered.length
	for (let i = 0; i < total; i++) {
		const node = reordered[i]
		if (node === undefined) continue
		const nextPosition = total - 1 - i
		if (node.id === draggedId) {
			moves.push({ id: node.id, parentId: newParentId, position: nextPosition })
			continue
		}
		if (node.position !== nextPosition || node.parentId !== newParentId) {
			moves.push({ id: node.id, parentId: newParentId, position: nextPosition })
		}
	}
	return moves
}
