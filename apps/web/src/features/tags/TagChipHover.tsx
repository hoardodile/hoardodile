import { imageSlotHasFile, isEmptyMeta } from "@hoardodile/schemas"
import {
	PreviewCard,
	PreviewCardPopup,
	PreviewCardPortal,
	PreviewCardPositioner,
	PreviewCardTrigger,
} from "@hoardodile/ui/components/preview-card"
import { type ReactElement, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { apiPaths } from "@/lib/paths"
import { hostnameOf, withScheme } from "@/lib/url"
import { useTagList } from "./store"
import { clampDisplaySize, type DisplaySize } from "./tagHoverSpec"

export type TagChipHoverProps = {
	/** The tag (display) id to resolve preview data for. */
	readonly tagId: string
	/** The chip element the card is anchored to. */
	readonly children: ReactElement
	readonly className?: string
}

/**
 * Read-only hover preview card for a tag chip (GitHub-style): hovering
 * (or keyboard-focusing) the chip opens a small card with the tag's art,
 * intro and link, resolved from the global tag list — no extra request.
 *
 * The card always presents the **display** tag's data — the same collapse
 * rule as the chip's own name/color. Artwork renders at its own size
 * (clamped to the {@link tagHoverSpec} window, no grey backing), the
 * name is intentionally not repeated (the trigger already says it), and
 * the link sits in grey small type with an underline on hover. Chips
 * with nothing to show render bare, keeping decorative chips free of any
 * hover cost; chips that do have content get a subtle ring on hover so
 * the affordance exists without disturbing the chip's static look.
 */
const HOVER_OPEN_DELAY = 200
const HOVER_CLOSE_DELAY = 120

export function TagChipHover(props: TagChipHoverProps) {
	const { tagId, children, className } = props
	const { t } = useTranslation()
	const tags = useTagList()
	const tag = tags.find((candidate) => candidate.id === tagId)
	const [open, setOpen] = useState(false)
	const [imgFailed, setImgFailed] = useState(false)
	const [naturalSize, setNaturalSize] = useState<DisplaySize | undefined>(
		undefined,
	)
	const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	function clearTimers() {
		if (openTimer.current !== null) clearTimeout(openTimer.current)
		if (closeTimer.current !== null) clearTimeout(closeTimer.current)
		openTimer.current = null
		closeTimer.current = null
	}

	function handlePointerEnter() {
		clearTimers()
		openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY)
	}

	function handlePointerLeave() {
		clearTimers()
		closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY)
	}

	function handleFocus() {
		clearTimers()
		openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY)
	}

	function handleBlur() {
		clearTimers()
		closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY)
	}

	// Clicks are never intercepted: Base UI reports trigger presses but we
	// ignore them, so navigation/selection stays on the chip. The open
	// state is fully owned here — Base UI's internal hover state machine
	// stays inert (it can wedge in the sortable management panel: the
	// close animation never completes and re-hovering never re-opens).
	function handleOpenChange(_next: boolean, _details: { reason?: string }) {
		// Intentionally no-op: the controlled `open` is the only source
		// of truth, and our own mouse/focus handlers drive it.
	}

	// Escape closes the card (keyboard dismissal parity with the
	// previously built-in behaviour).
	useEffect(() => {
		if (!open) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setOpen(false)
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [open])

	// The hover state is owned here instead of Base UI's interactive
	// trigger: its open/close state machine can wedge in the sortable
	// management panel (close animation never completes, so re-hovering
	// never re-opens until the component remounts). Timers are cleared on
	// unmount so a removed chip never leaks a pending open.
	useEffect(() => clearTimers, [])

	useEffect(() => {
		setImgFailed(false)
		setNaturalSize(undefined)
		setOpen(false)
		clearTimers()
	}, [tagId])

	if (tag === undefined) return children

	const hasImage = imageSlotHasFile(tag.imageMeta) === true
	const link = tag.link?.trim() ?? ""
	const intro = tag.intro.trim()
	const canShow = hasImage || link !== "" || intro !== ""
	if (!canShow) return children

	const thumbSrc = hasImage
		? `${apiPaths.tags.thumb(tag.id)}?v=${tag.updatedAt}`
		: undefined
	const linkLabel = hostnameOf(link) ?? t("tags.card.openLink")
	const artMeta =
		hasImage && tag.imageMeta !== undefined && !isEmptyMeta(tag.imageMeta)
			? tag.imageMeta
			: undefined
	// Seed from the server-reported dimensions, calibrate on load.
	const seedSize =
		artMeta !== undefined
			? clampDisplaySize(artMeta.width ?? 1, artMeta.height ?? 1)
			: undefined
	const artSize = naturalSize ?? seedSize ?? clampDisplaySize(1, 1)

	return (
		<PreviewCard open={open} onOpenChange={handleOpenChange}>
			<PreviewCardTrigger
				render={children}
				onMouseEnter={handlePointerEnter}
				onMouseLeave={handlePointerLeave}
				onFocus={handleFocus}
				onBlur={handleBlur}
				className="transition-shadow hover:ring-1 hover:ring-primary/20 focus-visible:ring-1 focus-visible:ring-primary/20"
			/>
			<PreviewCardPortal>
				<PreviewCardPositioner className={className}>
					<PreviewCardPopup
						aria-label={t("tags.card.aria", { name: tag.name })}
						className="w-fit overflow-hidden p-0"
						onMouseEnter={clearTimers}
						onMouseLeave={handlePointerLeave}
					>
						<div className="flex w-fit flex-col gap-2 p-3">
							{thumbSrc !== undefined && !imgFailed ? (
								<img
									src={thumbSrc}
									alt=""
									loading="lazy"
									aria-hidden
									width={artSize.width}
									height={artSize.height}
									onLoad={(event) => {
										const img = event.currentTarget
										setNaturalSize(
											clampDisplaySize(
												img.naturalWidth || 1,
												img.naturalHeight || 1,
											),
										)
									}}
									onError={() => setImgFailed(true)}
									className="mx-auto rounded-md object-contain"
									data-testid={`tag-hover-art-${tag.id}`}
								/>
							) : null}
							{intro !== "" ? (
								<p className="line-clamp-2 w-full text-xs leading-5 text-muted-foreground">
									{intro}
								</p>
							) : null}
							{link !== "" ? (
								<ExternalLink
									href={withScheme(link)}
									className="w-full truncate text-xs text-muted-foreground hover:underline"
									data-testid={`tag-hover-link-${tag.id}`}
								>
									{linkLabel}
								</ExternalLink>
							) : null}
						</div>
					</PreviewCardPopup>
				</PreviewCardPositioner>
			</PreviewCardPortal>
		</PreviewCard>
	)
}
