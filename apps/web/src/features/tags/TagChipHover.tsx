import { imageSlotHasFile, isEmptyMeta } from "@hoardodile/schemas"
import {
	PreviewCard,
	PreviewCardPopup,
	PreviewCardPortal,
	PreviewCardPositioner,
	PreviewCardTrigger,
} from "@hoardodile/ui/components/preview-card"
import { type ReactElement, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { apiPaths } from "@/lib/paths"
import { hostnameOf, withScheme } from "@/lib/url"
import { useTagList } from "./store"
import { clampDisplaySize, TAG_HOVER_IMAGE_MAX } from "./tagHoverSpec"

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
 *
 * Open/close/anchoring/animations are owned entirely by Base UI's
 * preview-card state machine (uncontrolled). The trigger clones the chip
 * into itself and merges its popup-interaction props onto it — including
 * the dismiss `onClick`, a no-op with the default `referencePress`.
 * `TagChip`'s root element is fixed by its `display` prop, never by the
 * presence of an `onClick`, so the merge can never swap the chip's
 * element under the hover listeners.
 */
export function TagChipHover(props: TagChipHoverProps) {
	const { tagId, children, className } = props
	const { t } = useTranslation()
	const tags = useTagList()
	const tag = tags.find((candidate) => candidate.id === tagId)
	const [imgFailed, setImgFailed] = useState(false)

	useEffect(() => {
		setImgFailed(false)
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
	// The artwork size comes from the server-reported dimensions only —
	// a single source of truth. Re-measuring on `load` made the card
	// change size mid-open (layout shift + floating re-positioning reads
	// as a double animation), so the natural size is never applied.
	const artSize =
		artMeta !== undefined
			? clampDisplaySize(artMeta.width ?? 1, artMeta.height ?? 1)
			: { width: TAG_HOVER_IMAGE_MAX.width, height: TAG_HOVER_IMAGE_MAX.height }

	return (
		<PreviewCard>
			<PreviewCardTrigger
				delay={200}
				closeDelay={120}
				render={children}
				className="transition-shadow hover:ring-1 hover:ring-primary/20 focus-visible:ring-1 focus-visible:ring-primary/20"
			/>
			<PreviewCardPortal>
				<PreviewCardPositioner className={className}>
					<PreviewCardPopup
						aria-label={t("tags.card.aria", { name: tag.name })}
						className="w-fit overflow-hidden p-0"
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
