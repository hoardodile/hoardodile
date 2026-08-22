import { cn } from "@hoardodile/ui/lib/utils"
import {
	Fragment,
	type KeyboardEvent,
	type ReactNode,
	useId,
	useRef,
} from "react"

export type SectionTabTriggerProps = {
	readonly id: string
	readonly role: "tab"
	readonly tabIndex: number
	readonly "aria-selected": boolean
	readonly "aria-controls": string | undefined
	readonly "data-testid": string | undefined
	readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export type SectionTabItem<T extends string> = {
	readonly value: T
	readonly label: ReactNode
	readonly testId?: string
	/** Replaces the trigger element (e.g. a router Link) — receives the
	    active state, the trigger classes and the ARIA/keyboard props to
	    spread onto the element. */
	readonly render?: (
		active: boolean,
		className: string,
		trigger: SectionTabTriggerProps,
	) => ReactNode
	/** Content panel; mounted only while the tab is active. */
	readonly panel?: ReactNode
	/** Panel wrapper classes, replacing the default `mt-4`. */
	readonly panelClassName?: string
}

export type SectionTabsProps<T extends string> = {
	readonly value: T
	readonly items: readonly SectionTabItem<T>[]
	readonly onChange?: (value: T) => void
	readonly className?: string
	readonly panelClassName?: string
	/** Overrides for the tab bar itself (e.g. an indented side-panel bar). */
	readonly listClassName?: string
	/** Right-hand controls sharing the tab row (e.g. a sort toggle). */
	readonly controls?: ReactNode
	readonly ariaLabel?: string
}

const TRIGGER_CLASSES =
	"relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-none border-0 bg-transparent px-0.5 pt-1 pb-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 after:absolute after:inset-x-0 after:-bottom-[2px] after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity"

function triggerClassName(active: boolean): string {
	return cn(TRIGGER_CLASSES, active && "text-foreground after:opacity-100")
}

/**
 * Section-mode tab bar: uppercase 12px labels, a 2px underline on the
 * active tab over a 2px strong bottom edge, and a hidden horizontal
 * scrollbar on overflow. Standalone replacement for the shadcn tabs'
 * `section` variant — the group-data variant chains it leaned on were
 * too fragile to extend.
 */
export function SectionTabs<T extends string>(props: SectionTabsProps<T>) {
	const {
		value,
		items,
		onChange,
		className,
		panelClassName,
		listClassName,
		controls,
		ariaLabel,
	} = props
	const baseId = useId()
	const listRef = useRef<HTMLDivElement>(null)

	const activeIndex = items.findIndex((item) => item.value === value)
	const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined

	function activate(next: T): void {
		if (next !== value) onChange?.(next)
	}

	function focusTriggerAt(index: number): void {
		const trigger =
			listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]
		trigger?.focus()
	}

	function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
		const from = activeIndex < 0 ? 0 : activeIndex
		const count = items.length
		let nextIndex: number
		switch (event.key) {
			case "ArrowRight":
				nextIndex = (from + 1) % count
				break
			case "ArrowLeft":
				nextIndex = (from - 1 + count) % count
				break
			case "Home":
				nextIndex = 0
				break
			case "End":
				nextIndex = count - 1
				break
			default:
				return
		}
		event.preventDefault()
		const next = items[nextIndex]
		if (next === undefined) return
		activate(next.value)
		focusTriggerAt(nextIndex)
	}

	return (
		<div className={cn("flex min-w-0 flex-col gap-2", className)}>
			<div className="flex items-center gap-6">
				<div
					ref={listRef}
					role="tablist"
					aria-label={ariaLabel}
					className={cn(
						// The 2px strong edge is an inset shadow over the bottom
						// padding zone: the active underline (positioned 2px
						// below the trigger) lands inside the padding box —
						// a border would be outside it and get clipped by the
						// scroll list's overflow-y-hidden. The color reads the
						// runtime palette variable directly (what border-border
						// compiles to), not the @theme mirror — the mirror
						// lives in a cascade layer and is not reliable here.
						"flex min-w-0 flex-1 items-center gap-6 overflow-x-auto overflow-y-hidden no-scrollbar pb-0.5 shadow-[inset_0_-2px_0_0_var(--border)]",
						listClassName,
					)}
				>
					{items.map((item, index) => {
						const active = item.value === value
						const triggerProps: SectionTabTriggerProps = {
							id: `${baseId}-tab-${index}`,
							role: "tab",
							tabIndex: active ? 0 : -1,
							"aria-selected": active,
							"aria-controls":
								item.panel !== undefined
									? `${baseId}-panel-${index}`
									: undefined,
							"data-testid": item.testId,
							onKeyDown: handleKeyDown,
						}
						if (item.render !== undefined) {
							return (
								<Fragment key={item.value}>
									{item.render(active, triggerClassName(active), triggerProps)}
								</Fragment>
							)
						}
						return (
							<button
								key={item.value}
								type="button"
								{...triggerProps}
								onClick={() => activate(item.value)}
								className={triggerClassName(active)}
							>
								{item.label}
							</button>
						)
					})}
				</div>
				{controls}
			</div>
			{activeItem?.panel !== undefined ? (
				<div
					role="tabpanel"
					id={`${baseId}-panel-${activeIndex}`}
					aria-labelledby={`${baseId}-tab-${activeIndex}`}
					className={cn(
						"flex-1 text-sm outline-none",
						activeItem.panelClassName ?? panelClassName ?? "mt-4",
					)}
				>
					{activeItem.panel}
				</div>
			) : null}
		</div>
	)
}
