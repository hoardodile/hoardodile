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
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Input } from "@hoardodile/ui/components/input"
import { Switch } from "@hoardodile/ui/components/switch"
import { Cross } from "@hoardodile/ui/icons/marks"
import { SortVertical } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { type ReactNode, useState } from "react"

export type FontPickerLabels = {
	readonly inherit: string
	readonly inheritedHint: string
	readonly addCustom: string
	readonly selected: string
	readonly description: string
}

export type FontPickerProps = {
	readonly value: readonly string[]
	readonly onChange: (value: string[]) => void
	/**
	 * Controlled "inherit app font" state. When `onInheritChange` is
	 * provided the picker renders an inherit switch; the switch only
	 * decides whether the chosen stack is used (implementation-level
	 * fallback) — the picker itself always stays visible and editable,
	 * so the user can keep a stack ready while inheriting.
	 */
	readonly inherit?: boolean
	readonly onInheritChange?: (checked: boolean) => void
	readonly inheritedFonts?: readonly string[]
	readonly inheritedFamily?: string
	/** Preset tag rows (web/system/extra) — the consumer renders them
	    (registry knowledge and localized labels are app-side). */
	readonly presetTags?: ReactNode
	/**
	 * Resolves an entered name to its canonical stack value (and may load
	 * its CSS); returning `undefined` keeps the raw name.
	 */
	readonly resolveFont?: (name: string) => string | undefined
	/** Label and chip family for a stack entry. */
	readonly resolveEntry?: (name: string) => { label: string; family?: string }
	/** `font-family` for the live preview stack. */
	readonly previewFamily?: string
	readonly "data-testid"?: string
	readonly "aria-label"?: string
	/** Localized chrome labels. */
	readonly labels: FontPickerLabels
}

/**
 * Font picker with tag-style layout: optional preset tag rows on top,
 * a custom input below them, the selected fonts as draggable chips, and
 * an always-visible live preview. The font registry itself lives in the
 * consumer — presets, CSS loading and localized display names come in
 * through props.
 */
export function FontPicker(props: FontPickerProps) {
	const {
		value,
		onChange,
		inherit = false,
		onInheritChange,
		inheritedFonts,
		inheritedFamily,
		presetTags,
		resolveFont,
		resolveEntry,
		previewFamily,
		"data-testid": testId,
		"aria-label": ariaLabel,
		labels,
	} = props

	const [customInput, setCustomInput] = useState("")

	function addFont(name: string) {
		const trimmed = name.trim()
		if (trimmed.length === 0) return
		const resolved = resolveFont?.(trimmed) ?? trimmed
		if (value.includes(resolved)) return
		onChange([...value, resolved])
	}

	function removeFont(index: number) {
		onChange(value.filter((_, i) => i !== index))
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (over === null || active.id === over.id) return
		const oldIndex = value.indexOf(String(active.id))
		const newIndex = value.indexOf(String(over.id))
		onChange(arrayMove([...value], oldIndex, newIndex))
	}

	function handleCustomKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") {
			e.preventDefault()
			addFont(customInput)
			setCustomInput("")
		}
	}

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	return (
		<div className="flex flex-col gap-4" data-testid={testId}>
			{onInheritChange !== undefined && (
				<div className="flex items-center gap-2">
					<Switch
						checked={inherit}
						onCheckedChange={onInheritChange}
						aria-label={labels.inherit}
					/>
					<span className="text-sm">{labels.inherit}</span>
				</div>
			)}

			{inherit && (
				<p className="text-xs text-muted-foreground">
					{labels.inheritedHint}
					{inheritedFonts !== undefined && inheritedFonts.length > 0 && (
						<span className="ml-1" style={{ fontFamily: inheritedFamily }}>
							({inheritedFonts.join(" → ")})
						</span>
					)}
				</p>
			)}

			{presetTags !== undefined ? (
				<div className="flex flex-col gap-2">{presetTags}</div>
			) : null}

			{/* Custom font input */}
			<Input
				value={customInput}
				onChange={(e) => setCustomInput(e.target.value)}
				onKeyDown={handleCustomKeyDown}
				placeholder={labels.addCustom}
				aria-label={ariaLabel ?? labels.addCustom}
			/>

			{/* Selected font chips with drag sorting */}
			{value.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="text-xs text-muted-foreground">{labels.selected}</p>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={value as string[]}
							strategy={rectSortingStrategy}
						>
							<div className="flex flex-wrap gap-2">
								{value.map((name, index) => (
									<SortableFontChip
										key={name}
										name={name}
										resolveEntry={resolveEntry}
										onRemove={() => removeFont(index)}
									/>
								))}
							</div>
						</SortableContext>
					</DndContext>
				</div>
			)}

			{/* Live preview — the stack rendered in its own family. Always
			    visible: with no stack chosen the sample simply renders in
			    the system font. */}
			<div className="rounded-xl bg-background px-5 py-4">
				<div
					className="text-lg text-foreground"
					style={{ fontFamily: previewFamily }}
				>
					{labels.description}
				</div>
				{value.length > 0 && (
					<div className="mt-2 text-tiny text-muted-foreground">
						{value
							.map((name) => resolveEntry?.(name)?.label ?? name)
							.join(" · ")}
					</div>
				)}
			</div>
		</div>
	)
}

type SortableFontChipProps = {
	readonly name: string
	readonly resolveEntry?: FontPickerProps["resolveEntry"]
	readonly onRemove: () => void
}

function SortableFontChip(props: SortableFontChipProps) {
	const { name, resolveEntry, onRemove } = props
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: name, transition: null })

	const style: React.CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	}

	const entry = resolveEntry?.(name)
	const displayName = entry?.label ?? name

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-sm",
				isDragging && "z-10",
			)}
		>
			<button
				type="button"
				className="cursor-grab text-muted-foreground active:cursor-grabbing"
				{...attributes}
				{...listeners}
			>
				<SortVertical className="size-3.5" />
			</button>
			<span style={{ fontFamily: entry?.family ?? name }}>{displayName}</span>
			<button
				type="button"
				onClick={onRemove}
				className="text-muted-foreground hover:text-destructive"
			>
				<Cross className="size-3.5" />
			</button>
		</div>
	)
}
