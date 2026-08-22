import { Cross } from "@hoardodile/ui/icons/marks"
import { Bookmark, Palette } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type ColorPickerLabels = {
	/** Aria label for the value pill's clear button. */
	readonly clear: string
	/** Aria label for the pin-to-presets bookmark. */
	readonly addPreset: string
	/** Aria label for a user preset's remove button. */
	readonly removePresetAria: (color: string) => string
	/** Aria/title for the custom swatch (the OS picker input). */
	readonly customSwatch: string
}

export type ColorPickerProps = {
	readonly value: string
	readonly onChange: (color: string) => void
	/** Default preset colors — one dot each. */
	readonly presets?: readonly string[]
	/** User presets appended after the defaults; their dots carry a
	    hover-revealed remove. */
	readonly userPresets?: readonly string[]
	/** Pins the current custom value to the user presets. */
	readonly onAddPreset?: () => void
	readonly onRemovePreset?: (index: number) => void
	/** Special-style ids rendered as chips by the injected renderer
	    (the consumer owns the surface, e.g. gradient chips). */
	readonly specialStyles?: readonly string[]
	readonly renderSpecialStyle?: (
		style: string,
		active: boolean,
		onPick: () => void,
	) => ReactNode
	readonly placeholder?: string
	readonly testId?: string
	/** Localized chrome labels. */
	readonly labels: ColorPickerLabels
}

/**
 * Color field: the current value leads as a removable pill (a dot + hex
 * in a muted pill, or the special-style chip), the default and user
 * presets merge into one row of dots — whitespace parts the registers —
 * and the special styles ride below as their own chips. Custom colors
 * enter through the dashed swatch at the row's end (a real color input
 * underneath — the OS picker opens on click).
 */
export function ColorPicker(props: ColorPickerProps) {
	const {
		value,
		onChange,
		presets = [],
		userPresets = [],
		onAddPreset,
		onRemovePreset,
		specialStyles = [],
		renderSpecialStyle,
		placeholder,
		testId,
		labels,
	} = props

	const hasColor = value !== ""
	const isSpecial = specialStyles.includes(value)
	const isCustom =
		hasColor &&
		!isSpecial &&
		![...presets, ...userPresets]
			.map((c) => c.toLowerCase())
			.includes(value.toLowerCase())

	const inputValue = hasColor && !isSpecial ? value : "#9D9D9D"

	return (
		<div className="flex flex-col gap-2.5" data-testid={testId}>
			<span className="flex items-center gap-1.5">
				{hasColor && (
					<span
						className={cn(
							"inline-flex h-chip w-fit items-center gap-1 rounded-md pr-1.5 text-xs text-foreground",
							!isSpecial && "bg-muted pl-2",
						)}
					>
						{isSpecial && renderSpecialStyle !== undefined ? (
							<span className="pointer-events-none">
								{renderSpecialStyle(value, true, () => {})}
							</span>
						) : (
							<>
								<span
									className="size-2 shrink-0 rounded-full"
									style={{ backgroundColor: value }}
								/>
								<span className="-translate-y-px">{value}</span>
							</>
						)}
						<button
							type="button"
							onClick={() => onChange("")}
							aria-label={labels.clear}
							className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
							data-testid={testId !== undefined ? `${testId}-clear` : undefined}
						>
							<Cross className="size-3" />
						</button>
					</span>
				)}
				{isCustom && onAddPreset !== undefined && (
					<button
						type="button"
						onClick={onAddPreset}
						aria-label={labels.addPreset}
						className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
						data-testid={
							testId !== undefined ? `${testId}-add-preset` : undefined
						}
					>
						<Bookmark className="size-3" />
					</button>
				)}
			</span>

			{/* One row of dots: the default presets, then the user's own —
			    parted by whitespace, not labels. A my-preset dot's remove
			    appears on hover (pinned on the last one). */}
			<span className="flex flex-wrap items-center gap-1.5">
				{presets.map((color) => (
					<button
						type="button"
						key={color}
						onClick={() => onChange(color)}
						className="size-5 shrink-0 cursor-pointer rounded-full border-0 p-0"
						style={{ backgroundColor: color }}
						aria-label={color}
					/>
				))}
				{userPresets.map((color, index) => (
					<span key={`${color}-${index}`} className="group/color relative ml-2">
						<button
							type="button"
							onClick={() => onChange(color)}
							className="block size-5 cursor-pointer rounded-full border-0 p-0"
							style={{ backgroundColor: color }}
							aria-label={color}
						/>
						{onRemovePreset !== undefined && (
							<button
								type="button"
								onClick={() => onRemovePreset(index)}
								aria-label={labels.removePresetAria(color)}
								className={cn(
									"absolute -top-1 -right-1 flex size-3.5 cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 text-muted-foreground hover:text-foreground",
									index === userPresets.length - 1
										? "opacity-100"
										: "opacity-0 transition-opacity group-hover/color:opacity-100",
								)}
							>
								<Cross className="size-2" />
							</button>
						)}
					</span>
				))}
				{/* The custom swatch — dashed until a custom color is set, then
				    filled; the real color input underneath opens the OS
				    picker. */}
				<span
					title={labels.customSwatch}
					className={cn(
						"relative ml-2 flex size-5 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full",
						isCustom ? "" : "border border-dashed border-border-strong",
					)}
					style={isCustom ? { backgroundColor: value } : undefined}
				>
					{!isCustom && <Palette className="size-3 text-muted-foreground" />}
					<input
						type="color"
						value={inputValue}
						onChange={(e) => onChange(e.target.value)}
						className="absolute inset-0 cursor-pointer opacity-0"
						data-testid={testId !== undefined ? `${testId}-input` : undefined}
						title={placeholder}
						aria-label={labels.customSwatch}
					/>
				</span>
			</span>

			{specialStyles.length > 0 && renderSpecialStyle !== undefined ? (
				<span className="flex flex-wrap gap-1.5">
					{specialStyles.map((style) =>
						renderSpecialStyle(style, value === style, () => onChange(style)),
					)}
				</span>
			) : null}
		</div>
	)
}
