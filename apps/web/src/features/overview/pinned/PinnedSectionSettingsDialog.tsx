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
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { Switch } from "@hoardodile/ui/components/switch"
import { toast } from "@hoardodile/ui/components/toast"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Add } from "@hoardodile/ui/icons/actions"
import { HamburgerMenu, Pen } from "@hoardodile/ui/icons/registry"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { CharSearch } from "@/features/char/components/CharSearch"
import { ResSearch } from "@/features/res/components/ResSearch"
import { RESOURCE_SEARCH_DEFAULTS } from "@/features/res/utils/searchState"
import { randomUUID } from "@/lib/randomUUID"
import type {
	PinnedFilterConfig,
	PinnedFilters,
	PinnedSectionItem,
} from "./types"
import { DEFAULT_PINNED_SIZE, MAX_PINNED_SECTION_ITEMS } from "./types"
import { PINNED_REFRESH_INTERVALS } from "./useOverviewPinnedData"

export type PinnedSectionSettingsDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly sectionTitle: string
	readonly entityType: "resource" | "character"
	readonly items: readonly PinnedSectionItem[]
	readonly currentFilters: PinnedFilterConfig
	readonly onChange: (items: readonly PinnedSectionItem[]) => void
	readonly maxItems?: number
}

function extractPinnedFilters(config: PinnedFilterConfig): PinnedFilters {
	const {
		pinned: _pinned,
		title: _title,
		showWhenEmpty: _showWhenEmpty,
		size: _size,
		...filters
	} = config
	return filters as PinnedFilters
}

type PinnedItemRowProps = {
	readonly item: PinnedSectionItem
	readonly isSelected: boolean
	readonly onSelect: () => void
	readonly onToggleEnabled: () => void
	readonly onPreview: () => void
}

function PinnedItemRow(props: PinnedItemRowProps) {
	const { item, isSelected, onSelect, onToggleEnabled, onPreview } = props
	const { t } = useTranslation()

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.id, transition: null })

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	}

	const displayTitle =
		item.title ?? t("overview.pinned.settings.titlePlaceholder")

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${
				isSelected
					? "border-border-strong bg-accent"
					: "border-border bg-card hover:bg-accent/40"
			} ${isDragging ? "opacity-50" : ""} ${item.enabled === false ? "opacity-60" : ""}`}
			data-testid={`pinned-item-row-${item.id}`}
		>
			<button
				type="button"
				className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
				aria-label={t("overview.pinned.dragToReorder")}
				{...attributes}
				{...listeners}
			>
				<HamburgerMenu className="size-3.5" />
			</button>

			<button
				type="button"
				onClick={onSelect}
				className="min-w-0 flex-1 cursor-pointer truncate text-left text-ui font-medium text-foreground"
			>
				{displayTitle}
			</button>

			<Switch
				checked={item.enabled !== false}
				onCheckedChange={onToggleEnabled}
				aria-label={t("overview.pinned.settings.toggleEnabledAria", {
					title: displayTitle,
				})}
			/>

			<button
				type="button"
				onClick={onPreview}
				className="shrink-0 text-xs text-muted-foreground hover:text-secondary-foreground"
			>
				{t("overview.pinned.settings.preview")}
			</button>
		</div>
	)
}

type PinnedItemEditorProps = {
	readonly item: PinnedSectionItem | null
	readonly onUpdate: (item: PinnedSectionItem) => void
	readonly onSave: () => void
	readonly onDelete?: () => void
}

function PinnedItemEditor(props: PinnedItemEditorProps) {
	const { item, onUpdate, onSave, onDelete } = props
	const { t } = useTranslation()

	if (item === null) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
				<Pen className="size-8 opacity-40" />
				<p className="text-sm">{t("overview.pinned.settings.noSelection")}</p>
				<p className="text-xs">
					{t("overview.pinned.settings.noSelectionHint")}
				</p>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col gap-4 p-4">
			<div className="flex flex-col gap-1">
				<h4 className="text-sm font-semibold">
					{t("overview.pinned.settings.editTitle")}
				</h4>
				<p className="text-xs text-muted-foreground">
					{t("overview.pinned.settings.editDescription")}
				</p>
			</div>

			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-1.5">
					<Label
						htmlFor={`pinned-title-${item.id}`}
						className="text-xs font-normal text-muted-foreground"
					>
						{t("overview.pinned.settings.titleLabel")}
					</Label>
					<Input
						id={`pinned-title-${item.id}`}
						value={item.title ?? ""}
						autoFocus
						onChange={(e) =>
							onUpdate({
								...item,
								title: e.target.value.trimStart(),
							})
						}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								onSave()
							}
						}}
						placeholder={t("overview.pinned.settings.titlePlaceholder")}
					/>
				</div>

				<div className="flex flex-wrap items-center gap-4">
					<div className="flex flex-col gap-1.5">
						<Label
							htmlFor={`pinned-size-${item.id}`}
							className="text-xs font-normal text-muted-foreground"
						>
							{t("overview.pinned.settings.sizeLabel")}
						</Label>
						<Input
							id={`pinned-size-${item.id}`}
							type="number"
							min={1}
							max={100}
							value={item.size ?? DEFAULT_PINNED_SIZE}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10)
								onUpdate({
									...item,
									size: Number.isNaN(n) ? DEFAULT_PINNED_SIZE : n,
								})
							}}
							className="w-20"
						/>
					</div>
				</div>

				{item.random === true ? (
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs font-normal text-muted-foreground">
							{t("overview.pinned.settings.item.refresh.label")}
						</Label>
						<DropdownSelect
							value={String(item.refreshSec ?? 0)}
							onValueChange={(value) =>
								onUpdate({ ...item, refreshSec: Number(value) })
							}
							options={PINNED_REFRESH_INTERVALS.map((sec) => ({
								value: String(sec),
								label:
									sec === 0
										? t("overview.pinned.settings.item.refresh.always")
										: sec === -2
											? t("overview.pinned.settings.item.refresh.never")
											: sec === -1
												? t("overview.pinned.settings.item.refresh.midnight")
												: t(
														`overview.pinned.settings.item.refresh.every${sec}s`,
													),
							}))}
							aria-label={t("overview.pinned.settings.item.refresh.label")}
							data-testid="pinned-item-refresh-interval"
						/>
						<p className="text-xs text-muted-foreground">
							{t("overview.pinned.settings.item.refresh.description")}
						</p>
					</div>
				) : null}

				<div className="flex items-center justify-between gap-2">
					<Label
						htmlFor={`pinned-show-when-empty-${item.id}`}
						className="text-xs font-normal text-secondary-foreground"
					>
						{t("overview.pinned.settings.showWhenEmpty")}
					</Label>
					<Switch
						id={`pinned-show-when-empty-${item.id}`}
						checked={item.showWhenEmpty === true}
						onCheckedChange={(v) =>
							onUpdate({
								...item,
								showWhenEmpty: v === true,
							})
						}
					/>
				</div>
			</div>

			<div className="mt-auto flex items-center justify-end gap-2 pt-2">
				{onDelete !== undefined ? (
					<Button
						type="button"
						variant="ghost"
						onClick={onDelete}
						className="text-destructive hover:bg-destructive/10"
					>
						{t("overview.pinned.settings.delete")}
					</Button>
				) : null}
				<Button type="button" onClick={onSave}>
					{t("overview.pinned.settings.save")}
				</Button>
			</div>
		</div>
	)
}

type EmptyStateProps = {
	readonly currentFilters: PinnedFilterConfig
	readonly onAdd: () => void
	readonly canAdd: boolean
}

function PinnedEmptyState(props: EmptyStateProps) {
	const { currentFilters, onAdd, canAdd } = props
	const { t } = useTranslation()

	const hasFilters = useMemo(() => {
		const filters = extractPinnedFilters(currentFilters)
		return Object.values(filters).some((v) =>
			Array.isArray(v) ? v.length > 0 : Boolean(v),
		)
	}, [currentFilters])

	return (
		<div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
			<Pen className="size-8 opacity-40" />
			<p className="text-sm font-medium">
				{t("overview.pinned.settings.noItems")}
			</p>
			<p className="max-w-xs text-xs">
				{hasFilters
					? t("overview.pinned.settings.noItemsWithFiltersHint")
					: t("overview.pinned.settings.noItemsHint")}
			</p>
			{canAdd ? (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={onAdd}
					className="gap-1.5"
				>
					<Add className="size-4" />
					{t("overview.pinned.add")}
				</Button>
			) : null}
		</div>
	)
}

type PinnedSearchPreviewDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly entityType: "resource" | "character"
	readonly item: PinnedSectionItem | null
}

const previewQueryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
})

function PinnedSearchPreviewDialog(props: PinnedSearchPreviewDialogProps) {
	const { open, onOpenChange, entityType, item } = props
	const { t } = useTranslation()

	if (item === null) return null

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("overview.pinned.settings.previewTitle")}
			size="2xl"
			flush
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<QueryClientProvider client={previewQueryClient}>
				{entityType === "resource" ? (
					<ResSearch
						initialState={{
							...RESOURCE_SEARCH_DEFAULTS,
							query: item.query ?? "",
							tagIds: item.tagIds ?? [],
							tagMode: item.tagMode ?? "and",
							noCharacters: item.noCharacters ?? false,
							contentPluginId: item.contentPluginId ?? "",
							searchMetaFacets: item.searchMetaFacets ?? {},
							searchIntro: item.searchIntro ?? false,
							sortBy: item.sortBy ?? RESOURCE_SEARCH_DEFAULTS.sortBy,
							order: item.order ?? RESOURCE_SEARCH_DEFAULTS.order,
							random: item.random ?? false,
							size: item.size ?? DEFAULT_PINNED_SIZE,
						}}
					/>
				) : (
					<CharSearch
						initialState={{
							query: item.query ?? "",
							tagIds: item.tagIds ?? [],
							tagMode: item.tagMode ?? "and",
							traitFilters: item.traitFilters ?? [],
							relationshipTypeIds: item.relationshipTypeIds ?? [],
							searchIntro: item.searchIntro ?? false,
							sortBy: item.sortBy ?? "created",
							order: item.order ?? "desc",
							random: item.random ?? false,
						}}
					/>
				)}
			</QueryClientProvider>
		</AppDialog>
	)
}

export function PinnedSectionSettingsDialog(
	props: PinnedSectionSettingsDialogProps,
) {
	const {
		open,
		onOpenChange,
		sectionTitle,
		entityType,
		items,
		currentFilters,
		onChange,
		maxItems = MAX_PINNED_SECTION_ITEMS,
	} = props
	const { t } = useTranslation()
	const deleteConfirm = useConfirmDialog<{ id: string; title: string }>()
	const previewConfirm = useConfirmDialog<{ item: PinnedSectionItem }>()

	const [draftItems, setDraftItems] =
		useState<readonly PinnedSectionItem[]>(items)
	const [selectedId, setSelectedId] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setDraftItems(items)
		setSelectedId((prev) =>
			items.some((item) => item.id === prev) ? prev : null,
		)
	}, [open, items])

	const reorderDebounceRef = useRef<number | null>(null)
	const latestDraftItemsRef = useRef(draftItems)
	latestDraftItemsRef.current = draftItems

	function flushReorderSave() {
		if (reorderDebounceRef.current !== null) {
			window.clearTimeout(reorderDebounceRef.current)
			reorderDebounceRef.current = null
		}
	}

	function scheduleReorderSave() {
		flushReorderSave()
		reorderDebounceRef.current = window.setTimeout(() => {
			onChange(latestDraftItemsRef.current)
			reorderDebounceRef.current = null
		}, 500)
	}

	useEffect(() => {
		return () => {
			flushReorderSave()
		}
	}, [])

	const canAdd = draftItems.length < maxItems
	const isAtMax = draftItems.length >= maxItems

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	function commit(nextItems: readonly PinnedSectionItem[]) {
		setDraftItems(nextItems)
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (over === null || active.id === over.id) return
		const ids = draftItems.map((item) => item.id)
		const oldIndex = ids.indexOf(String(active.id))
		const newIndex = ids.indexOf(String(over.id))
		if (oldIndex < 0 || newIndex < 0) return
		commit(arrayMove([...draftItems], oldIndex, newIndex))
		scheduleReorderSave()
	}

	function handleAdd() {
		if (!canAdd) return
		const next: PinnedSectionItem = {
			id: randomUUID(),
			enabled: true,
			...extractPinnedFilters(currentFilters),
		}
		const nextItems = [next, ...draftItems]
		commit(nextItems)
		setSelectedId(next.id)
	}

	function handleUpdate(updated: PinnedSectionItem) {
		commit(draftItems.map((item) => (item.id === updated.id ? updated : item)))
	}

	function handleToggleEnabled(id: string) {
		commit(
			draftItems.map((item) =>
				item.id === id ? { ...item, enabled: !(item.enabled !== false) } : item,
			),
		)
	}

	function handleDelete(id: string) {
		const nextItems = draftItems.filter((item) => item.id !== id)
		commit(nextItems)
		if (selectedId === id) {
			setSelectedId(null)
		}
	}

	function handleConfirmDelete(id: string) {
		handleDelete(id)
		flushReorderSave()
		onChange(latestDraftItemsRef.current.filter((item) => item.id !== id))
		toast.add({
			title: t("overview.pinned.settings.deleteSuccess"),
			type: "success",
		})
	}

	function handleSave() {
		flushReorderSave()
		onChange(draftItems)
		toast.add({
			title: t("overview.pinned.settings.saveSuccess"),
			type: "success",
		})
	}

	function handleCancel() {
		onOpenChange(false)
	}

	function handleDone() {
		handleSave()
		onOpenChange(false)
	}

	const selectedItem = draftItems.find((item) => item.id === selectedId) ?? null
	const hasItems = draftItems.length > 0

	return (
		<>
			<AppDialog
				open={open}
				onOpenChange={onOpenChange}
				title={t("overview.pinned.settings.title", { section: sectionTitle })}
				description={t("overview.pinned.settings.description")}
				size="xl"
				flush
				footer={
					<div className="flex w-full items-center justify-end gap-2">
						<Button type="button" variant="secondary" onClick={handleCancel}>
							{t("common.cancel")}
						</Button>
						<Button type="button" onClick={handleDone}>
							{t("overview.pinned.settings.done")}
						</Button>
					</div>
				}
			>
				<div className="grid min-h-105 grid-cols-1 md:grid-cols-[1fr_300px]">
					<div className="flex flex-col gap-4 border-b p-4 md:border-b-0 md:border-r">
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs text-muted-foreground">
								{t("overview.pinned.settings.sectionsCount", {
									count: draftItems.length,
								})}
							</span>
							<Tooltip>
								<TooltipTrigger
									render={
										<span className="inline-flex">
											<Button
												type="button"
												variant="secondary"
												onClick={handleAdd}
												disabled={!canAdd}
												data-testid="pinned-add-button"
											>
												<Add className="size-4" />
												{t("overview.pinned.add")}
											</Button>
										</span>
									}
								/>
								{isAtMax ? (
									<TooltipContent>
										{t("overview.pinned.maxReached", { max: maxItems })}
									</TooltipContent>
								) : null}
							</Tooltip>
						</div>

						{hasItems ? (
							<DndContext
								sensors={sensors}
								collisionDetection={closestCenter}
								onDragEnd={handleDragEnd}
							>
								<SortableContext
									items={draftItems.map((item) => item.id)}
									strategy={verticalListSortingStrategy}
								>
									<div className="flex flex-col gap-3">
										{draftItems.map((item) => (
											<PinnedItemRow
												key={item.id}
												item={item}
												isSelected={selectedId === item.id}
												onSelect={() => setSelectedId(item.id)}
												onToggleEnabled={() => handleToggleEnabled(item.id)}
												onPreview={() => previewConfirm.open({ item })}
											/>
										))}
									</div>
								</SortableContext>
							</DndContext>
						) : (
							<PinnedEmptyState
								currentFilters={currentFilters}
								onAdd={handleAdd}
								canAdd={canAdd}
							/>
						)}
					</div>

					<div className="flex min-h-75 flex-col bg-muted/20">
						<PinnedItemEditor
							item={selectedItem}
							onUpdate={handleUpdate}
							onSave={handleSave}
							onDelete={
								selectedItem !== null
									? () =>
											deleteConfirm.open({
												id: selectedItem.id,
												title:
													selectedItem.title ??
													t("overview.pinned.settings.titlePlaceholder"),
											})
									: undefined
							}
						/>
					</div>
				</div>
			</AppDialog>
			<ConfirmDialog
				open={deleteConfirm.isOpen}
				onOpenChange={deleteConfirm.onOpenChange}
				title={t("overview.pinned.settings.deleteConfirmTitle")}
				description={t("overview.pinned.settings.deleteConfirmDescription", {
					title: deleteConfirm.target?.title ?? "",
				})}
				confirmLabel={t("common.delete")}
				confirmTestId="pinned-delete-confirm"
				isPending={false}
				destructive
				onConfirm={() => {
					const id = deleteConfirm.target?.id
					if (id !== undefined) {
						handleConfirmDelete(id)
					}
					deleteConfirm.close()
				}}
			/>
			<PinnedSearchPreviewDialog
				open={previewConfirm.isOpen}
				onOpenChange={previewConfirm.onOpenChange}
				entityType={entityType}
				item={previewConfirm.target?.item ?? null}
			/>
		</>
	)
}
