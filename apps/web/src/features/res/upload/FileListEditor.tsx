import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core"
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Badge } from "@hoardodile/ui/components/badge"
import { Button } from "@hoardodile/ui/components/button"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Cross } from "@hoardodile/ui/icons/marks"
import { GalleryAdd } from "@hoardodile/ui/icons/registry"
import { useCallback, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useWheelHorizontalScroll } from "@/hooks/useWheelHorizontalScroll"
import { formatBytes } from "@/lib/formatBytes"
import { randomUUID } from "@/lib/randomUUID"
import { extensionLabel } from "./clientThumbnail"
import { type ThumbState, useFileThumb, useInView } from "./useFileThumb"

// ── Types ────────────────────────────────────────────────────────────────────

export type FileListEntry = {
	readonly id: string
	readonly file: File
}

export type FileListEditorProps = {
	readonly entries: readonly FileListEntry[]
	readonly displayOrder?: readonly number[]
	readonly onEntriesChange: (entries: readonly FileListEntry[]) => void
	readonly onOrderChange: (order: readonly number[]) => void
	readonly disabled?: boolean
	/**
	 * Per-entry server-staged `fileId`s, aligned 1:1 with `entries` order.
	 * `undefined` at a position means that file has not finished staging
	 * yet; when present the thumb is fetched from the backend preview
	 * endpoint as soon as the tile is visible.
	 */
	readonly fileIds?: ReadonlyArray<string | undefined>
	/** Per-file staging progress (0–1), aligned to `entries` order. */
	readonly fileProgresses?: ReadonlyArray<number>
}

// ── Public component ────────────────────────────────────────────────────────

/**
 * Sortable horizontal gallery editor for a batch of sequence files about
 * to be uploaded as an `ordered` resource. Flat visual style aligned with
 * the "Me" page: rendered inside the parent's UploadSection card — the
 * section header, its aside meta, and the clear-all action live on the
 * parent — with a light badge row and square thumbnails with subtle
 * borders.
 */
export function FileListEditor(props: FileListEditorProps) {
	const {
		entries,
		displayOrder,
		onEntriesChange,
		onOrderChange,
		disabled,
		fileIds,
		fileProgresses,
	} = props
	const { t } = useTranslation()

	const order = displayOrder ?? entries.map((_, i) => i)
	const orderedEntries = order
		.map((i) => entries[i])
		.filter((e) => e !== undefined)

	// Lowercased names that appear more than once: the server will
	// auto-suffix those at commit (`1.jpg` → `1-1.jpg`), so the tiles
	// surface the collision before upload.
	const duplicateNameKeys = useMemo(() => {
		const counts = new Map<string, number>()
		for (const entry of entries) {
			const key = entry.file.name.toLowerCase()
			counts.set(key, (counts.get(key) ?? 0) + 1)
		}
		const out = new Set<string>()
		for (const [key, count] of counts) {
			if (count > 1) out.add(key)
		}
		return out
	}, [entries])

	const inputRef = useRef<HTMLInputElement>(null)
	const [listNode, setListNode] = useState<HTMLUListElement | null>(null)
	const [dragOver, setDragOver] = useState(false)

	useWheelHorizontalScroll(listNode)
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (over === null || active.id === over.id) return
		const oldIndex = orderedEntries.findIndex((e) => e.id === active.id)
		const newIndex = orderedEntries.findIndex((e) => e.id === over.id)
		if (oldIndex < 0 || newIndex < 0) return
		onOrderChange(arrayMove([...order], oldIndex, newIndex))
	}

	function handleRemove(id: string) {
		const sourceIndex = entries.findIndex((e) => e.id === id)
		if (sourceIndex < 0) return
		onEntriesChange(entries.filter((e) => e.id !== id))
		onOrderChange(
			order
				.filter((i) => i !== sourceIndex)
				.map((i) => (i > sourceIndex ? i - 1 : i)),
		)
	}

	function handlePick(picked: FileList | null) {
		if (picked === null || picked.length === 0) return
		const added = Array.from(picked).map((file) => ({
			id: randomUUID(),
			file,
		}))
		onEntriesChange([...entries, ...added])
		onOrderChange([...order, ...added.map((_, i) => entries.length + i)])
	}

	function openPicker() {
		if (disabled === true) return
		inputRef.current?.click()
	}

	const totalBytes = entries.reduce((acc, e) => acc + e.file.size, 0)

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				multiple
				className="sr-only"
				data-testid="create-resource-files"
				disabled={disabled}
				onChange={(e) => {
					handlePick(e.target.files)
					e.target.value = ""
				}}
			/>

			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<Badge
					variant="secondary"
					className="rounded-md font-normal"
					data-testid="upload-total-size"
				>
					{formatBytes(totalBytes)}
				</Badge>
				<Badge
					variant="outline"
					className="rounded-md font-normal"
					data-testid="create-resource-file-count"
				>
					{t("upload.totalCount", { count: entries.length })}
				</Badge>
				{fileProgresses != null && fileProgresses.length > 0 ? (
					<Badge
						variant="default"
						className="rounded-md font-normal"
						data-testid="upload-staging-progress"
					>
						{fileProgresses.filter((p) => p >= 0.99).length} / {entries.length}
					</Badge>
				) : null}
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={orderedEntries.map((e) => e.id)}
					strategy={horizontalListSortingStrategy}
				>
					<ul
						ref={setListNode}
						className="flex h-46 flex-row gap-4 overflow-x-scroll pt-2"
						data-testid="upload-file-strip"
					>
						{orderedEntries.map((entry, idx) => {
							const sourceIndex = order[idx]
							const progress =
								sourceIndex !== undefined
									? fileProgresses?.[sourceIndex]
									: undefined
							const stagedFileId =
								sourceIndex !== undefined ? fileIds?.[sourceIndex] : undefined
							return (
								<SortableThumb
									key={entry.id}
									entry={entry}
									progress={progress}
									stagedFileId={stagedFileId}
									scrollRoot={listNode}
									onRemove={() => handleRemove(entry.id)}
									disabled={disabled === true}
									duplicate={duplicateNameKeys.has(
										entry.file.name.toLowerCase(),
									)}
								/>
							)
						})}
						<AddTile
							active={dragOver}
							disabled={disabled === true}
							onClick={openPicker}
							onDrop={(droppedFiles) => {
								setDragOver(false)
								handlePick(droppedFiles)
							}}
							onDragOver={setDragOver}
						/>
					</ul>
				</SortableContext>
			</DndContext>
		</>
	)
}

// ── Internals ────────────────────────────────────────────────────────────────

type SortableThumbProps = {
	readonly entry: FileListEntry
	readonly stagedFileId?: string
	readonly progress?: number
	readonly scrollRoot: HTMLElement | null
	readonly onRemove: () => void
	readonly disabled: boolean
	/** True when another entry shares this file's (case-insensitive) name. */
	readonly duplicate: boolean
}

function SortableThumb(props: SortableThumbProps) {
	const {
		entry,
		stagedFileId,
		progress,
		scrollRoot,
		onRemove,
		disabled,
		duplicate,
	} = props
	const { t } = useTranslation()
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: entry.id })

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	}

	const [liNode, setLiNode] = useState<HTMLLIElement | null>(null)
	const setRefs = useCallback(
		(node: HTMLLIElement | null) => {
			setNodeRef(node)
			setLiNode(node)
		},
		[setNodeRef],
	)
	const inView = useInView(liNode, scrollRoot)
	const meta = useFileThumb(stagedFileId, entry.file, inView)
	const showProgress = progress !== undefined && progress >= 0 && progress < 1
	const failed = progress !== undefined && progress < 0

	return (
		<li
			ref={setRefs}
			style={style}
			className="group relative flex h-40 w-40 shrink-0 cursor-move select-none items-center justify-center overflow-hidden rounded-lg border bg-muted"
			data-testid={`upload-file-thumb-${entry.id}`}
			{...attributes}
			{...listeners}
		>
			<ThumbBackground thumb={meta} fileName={entry.file.name} />

			{showProgress ? (
				<div className="absolute inset-x-0 top-0 z-10 h-1 bg-black/30">
					<div
						className="h-full bg-primary transition-[width] duration-200 ease-out"
						style={{ width: `${Math.round(progress * 100)}%` }}
					/>
				</div>
			) : null}

			<Button
				type="button"
				aria-label={t("upload.removeFile")}
				variant="secondary"
				size="icon"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation()
					if (!disabled) onRemove()
				}}
				disabled={disabled}
				className="absolute right-2 top-2 z-10 size-7 rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
			>
				<Cross className="h-4 w-4" />
			</Button>

			{failed ? (
				<span className="absolute left-1.5 top-1.5 z-10 rounded bg-black/55 px-1.5 py-0.5 text-xs leading-tight text-white">
					{t("upload.failed")}
				</span>
			) : duplicate ? (
				<span
					className="absolute left-1.5 top-1.5 z-10 rounded bg-black/55 px-1.5 py-0.5 text-xs leading-tight text-white"
					title={t("upload.duplicateNameTitle")}
				>
					{t("upload.duplicateName")}
				</span>
			) : null}

			<div
				className="absolute inset-x-0 bottom-0 z-10 truncate bg-black/55 px-1.5 py-0.5 text-xs leading-tight text-white"
				title={`${entry.file.name} · ${formatBytes(entry.file.size)} · ${entry.file.type || "unknown"}`}
				dir="ltr"
			>
				{entry.file.name}
			</div>
		</li>
	)
}

type AddTileProps = {
	readonly active: boolean
	readonly disabled: boolean
	readonly onClick: () => void
	readonly onDrop: (files: FileList) => void
	readonly onDragOver: (over: boolean) => void
}

function AddTile(props: AddTileProps) {
	const { active, disabled, onClick, onDrop, onDragOver } = props
	const { t } = useTranslation()
	return (
		<li className="list-none">
			<button
				type="button"
				className={`flex h-40 w-40 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground transition-colors duration-200 ${
					active ? "border-primary bg-accent" : "border-border hover:bg-accent"
				} ${disabled ? "pointer-events-none opacity-50" : ""}`}
				onClick={onClick}
				disabled={disabled}
				aria-label={t("upload.addFiles")}
				data-testid="upload-add-tile"
				onDragOver={(e) => {
					e.preventDefault()
					onDragOver(true)
				}}
				onDragLeave={() => onDragOver(false)}
				onDrop={(e) => {
					e.preventDefault()
					if (e.dataTransfer.files.length > 0) onDrop(e.dataTransfer.files)
					else onDragOver(false)
				}}
			>
				<GalleryAdd className="h-10 w-10 opacity-50" />
			</button>
		</li>
	)
}

type ThumbBackgroundProps = {
	readonly thumb: ThumbState
	readonly fileName: string
}

function ThumbBackground(props: ThumbBackgroundProps) {
	const { thumb, fileName } = props
	if (thumb.kind === "ready") {
		return (
			<img
				src={thumb.url}
				alt={fileName}
				className="absolute inset-0 h-full w-full object-contain"
				draggable={false}
			/>
		)
	}
	if (thumb.kind === "loading") {
		return <Skeleton className="h-full w-full rounded-none" />
	}
	return (
		<div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
			{extensionLabel(fileName)}
		</div>
	)
}
