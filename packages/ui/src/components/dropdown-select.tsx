import { cn } from "@hoardodile/ui/lib/utils"
import { AltArrowDown } from "@hoardodile/ui/icons/registry"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "./dropdown-menu"
import type * as React from "react"

export type DropdownSelectOption = {
	readonly value: string
	readonly label: React.ReactNode
}

type SharedProps = {
	readonly options: readonly DropdownSelectOption[]
	readonly placeholder?: string
	readonly triggerClassName?: string
	readonly contentClassName?: string
	readonly container?: HTMLElement | null
	readonly disabled?: boolean
	readonly modal?: boolean
	readonly "data-testid"?: string
	readonly "aria-label"?: string
}

function TriggerButton(
	props: {
		readonly label: React.ReactNode
		readonly placeholder?: string
		readonly className?: string
		readonly "data-testid"?: string
		readonly "aria-label"?: string
	} & Omit<React.ComponentProps<"button">, "aria-label">,
) {
	const {
		label,
		placeholder,
		className,
		"data-testid": testId,
		"aria-label": ariaLabel,
		...rest
	} = props
	return (
		<button
			type="button"
			data-slot="dropdown-select-trigger"
			data-placeholder={label === undefined ? true : undefined}
			className={cn(
				"inline-flex h-control w-fit shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-muted px-3 text-ui whitespace-nowrap text-secondary-foreground outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent active:bg-accent disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			data-testid={testId}
			aria-label={ariaLabel}
			{...rest}
		>
			{/* No line-clamp here: `display:-webkit-box` inside the w-fit
			    trigger would inflate the width computation and leave an empty
			    gap; the button's own whitespace-nowrap already prevents wrap. */}
			<span className="flex min-w-0 items-center gap-1.5">
				{label ?? placeholder}
			</span>
			<AltArrowDown className="pointer-events-none size-4 text-muted-foreground" />
		</button>
	)
}

export function DropdownSelect(props: {
	readonly value: string
	readonly onValueChange: (value: string) => void
} & SharedProps) {
	const {
		value,
		onValueChange,
		options,
		placeholder,
		triggerClassName,
		contentClassName,
		container,
		disabled,
		modal,
		"data-testid": testId,
		"aria-label": ariaLabel,
	} = props

	const selectedLabel = options.find((o) => o.value === value)?.label

	return (
		<DropdownMenu modal={modal}>
			<DropdownMenuTrigger
				disabled={disabled}
				render={
					<TriggerButton
						label={selectedLabel}
						placeholder={placeholder}
						className={triggerClassName}
						data-testid={testId}
						aria-label={ariaLabel}
					/>
				}
			/>
			<DropdownMenuContent
				container={container}
				// Size to the longest option instead of the trigger's width
				// (the base content is anchored to --anchor-width), capped
				// by the viewport. The `!` keeps the override deterministic.
				className={cn(
					"w-max! min-w-36 max-w-(--available-width)",
					contentClassName,
				)}
			>
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={onValueChange}
				>
					{options.map((opt) => (
						<DropdownMenuRadioItem
							key={opt.value}
							value={opt.value}
							// The longest option ("Associated time") must never
							// wrap to a second line.
							className="whitespace-nowrap"
							// Base UI radio items default to `closeOnClick={false}`;
							// a single-select must close on pick (Radix behavior).
							closeOnClick
						>
							{opt.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function DropdownMultiSelect(props: {
	readonly value: readonly string[]
	readonly onValueChange: (values: readonly string[]) => void
	/** Trigger label once more than one option is selected (e.g. "3 selected"). */
	readonly countLabel: (count: number) => React.ReactNode
} & SharedProps) {
	const {
		value,
		onValueChange,
		options,
		placeholder,
		countLabel,
		triggerClassName,
		contentClassName,
		container,
		disabled,
		"data-testid": testId,
		"aria-label": ariaLabel,
	} = props

	const selectedCount = value.length
	const triggerLabel =
		selectedCount === 0
			? undefined
			: selectedCount === 1
				? options.find((o) => o.value === value[0])?.label
				: countLabel(selectedCount)

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				render={
					<TriggerButton
						label={triggerLabel}
						placeholder={placeholder}
						className={triggerClassName}
						data-testid={testId}
						aria-label={ariaLabel}
					/>
				}
			/>
			<DropdownMenuContent
				container={container}
				// Size to the longest option instead of the trigger's width,
				// capped by the viewport (see DropdownSelect).
				className={cn(
					"w-max! min-w-36 max-w-(--available-width)",
					contentClassName,
				)}
			>
				{options.map((opt) => (
					<DropdownMenuCheckboxItem
						key={opt.value}
						className="whitespace-nowrap"
						checked={value.includes(opt.value)}
						onCheckedChange={(checked) => {
							if (checked === true) {
								onValueChange([...value, opt.value])
							} else {
								onValueChange(
									value.filter((v) => v !== opt.value),
								)
							}
						}}
					>
						{opt.label}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
