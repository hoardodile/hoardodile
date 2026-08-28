import { imageSlotHasFile } from "@hoardodile/schemas"
import {
	PreviewCard,
	PreviewCardPopup,
	PreviewCardPortal,
	PreviewCardPositioner,
	PreviewCardTrigger,
} from "@hoardodile/ui/components/preview-card"
import { Link } from "@hoardodile/ui/icons/registry"
import { type ReactElement, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { apiPaths } from "@/lib/paths"
import { hostnameOf, withScheme } from "@/lib/url"
import { useTagList } from "./store"

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
 * name, intro and link, resolved from the global tag list — no extra
 * request. When the tag has nothing to show (no art, no link, no intro)
 * the chip renders bare, keeping decorative chips free of any hover cost.
 *
 * The card always presents the **display** tag's data — the same collapse
 * rule as the chip's own name/color. Clicks are never intercepted: the
 * underlying chip keeps its own click semantics (navigation, selection),
 * and the card closes on outside press / escape / pointer leave.
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
	const canShow = hasImage || link !== "" || tag.intro.trim() !== ""
	if (!canShow) return children

	const thumbSrc = hasImage
		? `${apiPaths.tags.thumb(tag.id)}?v=${tag.updatedAt}`
		: undefined
	const linkLabel = hostnameOf(link) ?? t("tags.card.openLink")

	return (
		<PreviewCard>
			<PreviewCardTrigger delay={120} closeDelay={120} render={children} />
			<PreviewCardPortal>
				<PreviewCardPositioner className={className}>
					<PreviewCardPopup
						aria-label={t("tags.card.aria", { name: tag.name })}
						className="w-72 overflow-hidden p-0"
					>
						<div className="flex flex-col gap-2.5 p-4">
							{thumbSrc !== undefined && !imgFailed ? (
								<img
									src={thumbSrc}
									alt=""
									loading="lazy"
									aria-hidden
									onError={() => setImgFailed(true)}
									className="mx-auto max-h-32 w-full rounded-md bg-muted object-contain"
								/>
							) : null}
							<div
								className="flex min-w-0 items-center gap-1.5 text-sm font-medium"
								data-testid={`tag-hover-name-${tag.id}`}
							>
								{tag.color !== "" ? (
									<span
										className="size-2 shrink-0 rounded-full"
										style={{ background: tag.color }}
										aria-hidden
									/>
								) : null}
								<span className="min-w-0 truncate">{tag.name}</span>
							</div>
							{tag.intro.trim() !== "" ? (
								<p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
									{tag.intro}
								</p>
							) : null}
							{link !== "" ? (
								<ExternalLink
									href={withScheme(link)}
									className="flex items-center gap-1.5 text-xs text-secondary-foreground hover:text-foreground"
									data-testid={`tag-hover-link-${tag.id}`}
								>
									<Link className="size-3.5 shrink-0" aria-hidden />
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
