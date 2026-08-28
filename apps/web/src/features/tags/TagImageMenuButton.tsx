import { type ImageSlotMeta, imageSlotHasFile } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Gallery } from "@hoardodile/ui/icons/registry"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { apiPaths } from "@/lib/paths"
import { TagImageEditDialog } from "./TagImageEditDialog"

export type TagImageMenuButtonProps = {
	readonly tagId: string
	readonly tagName: string
	/** Rebuildable image-slot projection from the tag row. */
	readonly imageMeta?: ImageSlotMeta
	/** Cache-buster for the thumb (the tag's `updatedAt`). */
	readonly updatedAt: number
	readonly className?: string
}

/**
 * The single image entry point for a tag (character-cover style): an
 * always-visible icon button on the management card that shows the tag's
 * current art (20px) when one exists. The dropdown offers the one action
 * — upload/replace — which opens the shared crop panel; removal lives
 * inside that panel behind the same confirmation ritual as character
 * avatars and resource covers.
 */
export function TagImageMenuButton(props: TagImageMenuButtonProps) {
	const { tagId, tagName, imageMeta, updatedAt, className } = props
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [thumbFailed, setThumbFailed] = useState(false)

	const hasImage = imageSlotHasFile(imageMeta) === true
	const thumbSrc =
		hasImage && !thumbFailed
			? `${apiPaths.tags.thumb(tagId)}?v=${updatedAt}`
			: undefined

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							className={className}
							aria-label={t("tags.edit.imageSection")}
							data-testid={`tag-image-menu-${tagId}`}
						>
							{thumbSrc !== undefined ? (
								<img
									src={thumbSrc}
									alt=""
									aria-hidden
									onError={() => setThumbFailed(true)}
									className="size-5 rounded-sm object-contain"
								/>
							) : (
								<Gallery className="size-4" aria-hidden />
							)}
						</Button>
					}
				/>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onClick={() => setOpen(true)}
						data-testid={`tag-image-menu-item-${tagId}`}
					>
						{hasImage
							? t("tags.edit.replaceImage")
							: t("tags.edit.uploadImage")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{open ? (
				<TagImageEditDialog
					open
					tagId={tagId}
					tagName={tagName}
					onOpenChange={setOpen}
				/>
			) : null}
		</>
	)
}
