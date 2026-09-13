import { MagnifierZoomIn as MagniferZoomIn } from "@hoardodile/ui/icons/registry"

export type ThumbPreviewButtonProps = {
	readonly name: string
	/** Id used for the button's `data-testid` (`resource-preview-<id>`). */
	readonly resourceId?: string
	readonly onPreviewRequest: () => void
	/**
	 * Show the button on touch screens (below `md`) without a hover,
	 * mirroring the card actions trigger. Defaults to false: the button
	 * stays hover-only, which inline BlockNote embeds rely on so
	 * ProseMirror mousedowns are never intercepted.
	 */
	readonly touchVisible?: boolean
}

const HOVER_ONLY_CLASS =
	"pointer-events-none absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground/90 text-background opacity-0 shadow-card transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-foreground hover:text-background"

const TOUCH_VISIBLE_CLASS =
	"pointer-events-auto absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground/90 text-background opacity-100 shadow-card transition-opacity duration-200 focus-visible:opacity-100 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 hover:bg-foreground hover:text-background"

/**
 * The magnifying-glass preview affordance for a resource thumbnail.
 *
 * Deliberately placement-free (`absolute`, no containing block of its own):
 * the parent decides the box the button anchors to. Card grids render it in
 * the cover row — the same `relative` box the corner badges
 * ({@link ResMediaThumb}) and the actions trigger ({@link ResCardActions})
 * use — so it sits on the card's edge instead of the fitted cover's, while
 * inline document embeds host it in a box hugging the tile.
 *
 * Both placements rely on an ancestor carrying the `group` class for the
 * hover reveal; a permanently-mounted button would intercept the mousedown
 * ProseMirror needs to start a NodeSelection.
 */
export function ThumbPreviewButton(props: ThumbPreviewButtonProps) {
	const { name, resourceId, onPreviewRequest, touchVisible } = props
	return (
		<button
			type="button"
			aria-label={name}
			onClick={onPreviewRequest}
			className={touchVisible === true ? TOUCH_VISIBLE_CLASS : HOVER_ONLY_CLASS}
			{...(resourceId !== undefined
				? { "data-testid": `resource-preview-${resourceId}` }
				: {})}
		>
			<MagniferZoomIn className="size-4" />
		</button>
	)
}
