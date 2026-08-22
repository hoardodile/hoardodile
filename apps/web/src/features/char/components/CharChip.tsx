import type { Character } from "@hoardodile/schemas"
import { cn } from "@hoardodile/ui/lib/utils"
import type { CSSProperties, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { SpecialTagSurface } from "@/features/tags/SpecialTagSurface"
import { resolveTagChipSurface } from "@/features/tags/tagSurface"
import { CharThumb } from "./CharThumb"

export type CharChipProps = {
	readonly charId: string
	/** Character data when already resolved (e.g. via batch fetch). */
	readonly character:
		| Pick<Character, "name" | "updatedAt" | "imageMeta">
		| undefined
	/** Optional secondary line under the name (e.g. relationship label). */
	readonly subLabel?: string
	/**
	 * When set, tints the pill background/text like {@link TagChip};
	 * empty/omitted keeps the default muted pill.
	 */
	readonly color?: string
	/** When provided renders an `×` button calling this on click. */
	readonly onRemove?: () => void
	/**
	 * When `true`, the view-only variant renders as a plain `<span>` with
	 * no navigation. Useful inside selection-mode card surfaces where
	 * clicks must not steal focus from the surrounding selection target.
	 */
	readonly disableLink?: boolean
	/** When `true`, renders the character name beside the avatar (truncated). */
	readonly showName?: boolean
	readonly className?: string
	readonly testId?: string
}

/**
 * The pill's colored surface, from the shared tag resolver. Unlike the
 * tinted chips, the pill keeps a hairline border (`${color}30`) so it
 * reads as a distinct shape on cards.
 */
function getCharChipSurface(color: string | undefined): {
	readonly className: string
	readonly style: CSSProperties | undefined
	readonly specialSurface: ReactNode | null
} {
	if (color === undefined || color.length === 0) {
		return {
			className: "bg-muted",
			style: undefined,
			specialSurface: null,
		}
	}

	const surface = resolveTagChipSurface(color, false)
	if (surface.texture !== null) {
		return {
			className: cn("relative isolate border group", surface.className),
			style: surface.style,
			specialSurface: (
				<SpecialTagSurface
					style={surface.texture}
					className="absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
				/>
			),
		}
	}

	return {
		className: surface.className,
		style: { ...surface.style },
		specialSurface: null,
	}
}

/**
 * Compact avatar pill used in chip lists. By default the character name
 * is exposed via the native `title` tooltip on hover; pass `showName` to
 * render it beside the avatar (truncated).
 *
 * In view-only mode the avatar thumbnail opens the character detail
 * page in a new tab via `window.open`.
 *
 * Purely presentational — fetches nothing and renders the id when
 * `character` is undefined so it can be used inside lists that are
 * still loading.
 */
export function CharChip(props: CharChipProps) {
	const {
		charId,
		character,
		subLabel,
		color,
		onRemove,
		disableLink,
		showName,
		className,
		testId,
	} = props
	const { t } = useTranslation()
	// Pill anatomy: a 20px circular avatar (`size-5`), `text-xs` label.
	const dim = "size-5"
	const isViewOnly = onRemove === undefined
	const nameText = character?.name ?? charId
	const hasSubLabel = subLabel !== undefined && subLabel.length > 0
	const showNameText = showName === true
	const hasVisibleText = hasSubLabel || showNameText
	const tooltipTitle = hasSubLabel ? `${nameText} — ${subLabel}` : nameText
	const surface = getCharChipSurface(color)
	const containerClass = cn(
		"inline-flex min-w-0 items-center rounded-full transition duration-200",
		hasVisibleText || onRemove !== undefined ? "gap-2 pr-2" : "",
		surface.className,
		className,
	)
	const avatar = (
		<CharThumb
			charId={charId}
			variant="avatar"
			cacheKey={character?.updatedAt ?? 0}
			name={character?.name}
			nameFallback="initial"
			hoverOverlay={false}
			className={`${dim} shrink-0 rounded-full overflow-hidden`}
		/>
	)
	const textBlock = hasSubLabel ? (
		<span className="min-w-0 max-w-32 truncate text-xs">{subLabel}</span>
	) : showNameText ? (
		<span className="min-w-0 truncate text-xs">{nameText}</span>
	) : null

	function renderShell(content: ReactNode) {
		return (
			<span
				className={containerClass}
				style={surface.style}
				title={tooltipTitle}
				data-testid={testId}
			>
				{surface.specialSurface}
				{content}
			</span>
		)
	}

	function openCharacterDetail() {
		window.open(`/characters/${charId}`, "_blank", "noopener,noreferrer")
	}

	if (isViewOnly) {
		if (disableLink) {
			return renderShell(
				<>
					{avatar}
					{textBlock}
				</>,
			)
		}
		// Only the circular avatar is the click target — the name is
		// decorative (matches the pill anatomy).
		return renderShell(
			<>
				{/* No <a> tag — button + window.open keeps clipboard free of URLs */}
				<button
					type="button"
					className="size-5 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-full border-none bg-transparent p-0"
					onClick={openCharacterDetail}
				>
					{avatar}
				</button>
				{textBlock}
			</>,
		)
	}
	return renderShell(
		<>
			{avatar}
			{textBlock}
			<button
				type="button"
				onClick={onRemove}
				className="rounded-full p-0.5 hover:bg-background/60"
				aria-label={t("common.remove")}
				data-testid={testId !== undefined ? `${testId}-remove` : undefined}
			>
				×
			</button>
		</>,
	)
}
