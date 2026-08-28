import { cn } from "@hoardodile/ui/lib/utils"
import {
	type ComponentPropsWithoutRef,
	cloneElement,
	forwardRef,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	type Ref,
} from "react"
import { SpecialTagSurface } from "./SpecialTagSurface"
import { resolveTagChipSurface } from "./tagSurface"

/** The two sanctioned chip sizes: `sm` (default, `px-2 py-1`) for cards and
    inline rows, `md` (`px-2 py-1.5`) for the filterer facets (Categories,
    Traits, Relations). */
export type TagChipSize = "sm" | "md"

type TagChipBaseProps = {
	/**
	 * Effective display color. Special names (`silver`, `gold`, `rainbow`,
	 * ...) render their SVG texture; an empty string falls back to the
	 * default muted chip, taking the primary fill when `active`. Ignored
	 * when `border` is set — bordered modes never take a tint.
	 */
	readonly color?: string
	/** Chip height tier — see {@link TagChipSize}. */
	readonly size?: TagChipSize
	/**
	 * Border mode instead of the fill/ghost anatomies. Only `"dashed"`
	 * exists today (add pills, unused entities): a `border-dashed` hairline
	 * with muted ink and no color tint — `active` swaps in the accent fill
	 * with a transparent border so the width never moves with the state.
	 */
	readonly border?: "dashed"
	/** Selected: colored chips deepen to their hover tint, special styles
	    switch to their own active appearance, uncolored chips take the
	    primary fill. */
	readonly active?: boolean
	/** Leading icon; rides the chip's own gap, so no wrapper is needed. */
	readonly icon?: ReactNode
	/** False removes the right border-radius so the chip can glue flush
	    against a sibling (e.g. the category rail's chevron). */
	readonly roundedRight?: boolean
	/**
	 * Root element mode: `"inline"` (default) renders a plain `<span>`,
	 * `"button"` a real `<button type="button">`. The element is chosen
	 * only from this prop (or `render`) — passing an `onClick` never
	 * changes the element, so interactive wrappers (hover cards,
	 * popovers) that merge click handlers onto the chip cannot swap its
	 * DOM node mid-interaction.
	 */
	readonly display?: "inline" | "button"
	/**
	 * Polymorphic root: pass a `render={<button ... />}` element to render
	 * the chip as that element. The chip's own classes, style, handlers,
	 * texture and icon merge onto it, and the chip's children become the
	 * element's children — so the render element should carry only its own
	 * props. Wins over `display`; `display="button"` is the plain way to
	 * get a real button without supplying a render element.
	 */
	readonly render?: ReactElement<Record<string, unknown>>
	/**
	 * Trailing suffix, separated from the label by a middle dot (e.g. a
	 * trait's kind "cm" or a count). Rendered at the label's own size —
	 * same line box, so the chip height never depends on the suffix —
	 * with muted ink and a bold dot.
	 */
	readonly suffix?: ReactNode
	readonly children?: ReactNode
	readonly onMouseDown?: (event: MouseEvent<HTMLSpanElement>) => void
}

export type TagChipProps = TagChipBaseProps &
	Omit<ComponentPropsWithoutRef<"button">, keyof TagChipBaseProps>

/** Text container: ellipsis truncation that only clips horizontally —
    `truncate`'s `overflow: hidden` would also clip descenders (y, g, p)
    at the tight `leading-none` line box, so the x axis clips while the y
    axis stays visible. */
const tagChipLabelClassName =
	"min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap"

/**
 * The one tag chip: a single rounded pill (inline-flex, `rounded-sm`,
 * `px-2 py-1`, 12px text) that may carry an icon and a special SVG
 * texture. It renders as a span by default; interactive surfaces pass
 * `display="button"` (or `render={<button ... />}` for a custom root,
 * e.g. a navigation anchor) and the chip's styling lands on that
 * element — one element in the DOM plus a single text wrapper, no
 * deeper nesting.
 *
 * The root element is decided purely by `display`/`render` — never by
 * the presence of an `onClick`, so a chip's DOM element cannot change
 * between renders (the hover-card trigger merge in {@link TagChipHover}
 * relies on this).
 *
 * Coloring is delegated to {@link resolveTagChipSurface} so cards,
 * pickers, the doc editor and the character pills all share one
 * definition of "what a colored tag looks like".
 *
 * The chip forwards its root ref so composition wrappers (e.g. the
 * {@link TagChipHover} preview-card trigger, which clones the chip and
 * attaches a DOM ref for anchoring) can reach the actual element.
 */
export const TagChip = forwardRef<HTMLElement, TagChipProps>(
	function TagChip(props, ref) {
		const {
			color,
			size = "sm",
			border,
			active,
			icon,
			roundedRight,
			display,
			render,
			suffix,
			children,
			className,
			style,
			onMouseDown,
			...rest
		} = props
		const surface =
			border !== undefined
				? undefined
				: resolveTagChipSurface(color ?? "", active === true)

		// The root element is fixed by the display mode / render slot —
		// an onClick merged on by an interactive wrapper must never swap
		// the chip's element (see the component doc comment).
		const interactiveRoot = display === "button" || render !== undefined

		const stateClass =
			border === "dashed"
				? active === true
					? "border border-transparent bg-accent text-foreground"
					: "border border-dashed border-border-strong text-muted-foreground hover:text-secondary-foreground"
				: undefined

		// Texture and icon are the chip's own decoration, so they lead the
		// children even when the root element is swapped (render / button).
		const content = (
			<>
				{surface !== undefined && surface.texture !== null && (
					<SpecialTagSurface
						style={surface.texture}
						active={active}
						className="absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
					/>
				)}
				{icon !== undefined && (
					// Flex row: the slot accepts several icons as a fragment
					// (e.g. a kind glyph + the pin), and flex keeps the
					// blockified preflight svgs on one line.
					<span className="flex shrink-0 items-center gap-1 text-muted-foreground">
						{icon}
					</span>
				)}
				<span className={tagChipLabelClassName}>
					{children}
					{suffix !== undefined ? (
						<>
							<span className="font-bold mx-0.5">·</span>
							<span className="shrink-0 opacity-70">{suffix}</span>
						</>
					) : null}
				</span>
			</>
		)

		const chipClassName = cn(
			"inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 rounded-sm text-xs font-normal leading-none disabled:pointer-events-none disabled:opacity-50",
			size === "md" ? "px-2 py-1.5" : "px-2 py-1",
			roundedRight === false && "rounded-r-none",
			interactiveRoot && "cursor-pointer",
			surface?.className,
			stateClass,
			className,
		)
		const chipStyle = { ...surface?.style, ...style }

		if (render !== undefined) {
			return cloneElement(render, {
				...rest,
				ref,
				className: chipClassName,
				style: chipStyle,
				onMouseDown,
				children: content,
			})
		}

		if (display === "button") {
			return (
				<button
					type="button"
					ref={ref as Ref<HTMLButtonElement>}
					className={chipClassName}
					style={chipStyle}
					onMouseDown={onMouseDown}
					{...rest}
				>
					{content}
				</button>
			)
		}

		return (
			<span
				ref={ref as Ref<HTMLSpanElement>}
				className={chipClassName}
				style={chipStyle}
				onMouseDown={onMouseDown}
				{...rest}
			>
				{content}
			</span>
		)
	},
)
