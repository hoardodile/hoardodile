import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { useTranslation } from "react-i18next"
import { apiPaths } from "@/lib/paths"

export type CharImagePreviewDialogProps = {
	readonly open: boolean
	readonly charId: string
	readonly charName: string
	readonly variant: "avatar" | "fullbody"
	readonly updatedAt: number
	readonly onOpenChange: (open: boolean) => void
}

/**
 * Full-screen lightbox preview for a character's original avatar or
 * fullbody image. Uses a dark overlay and centers the image.
 */
export function CharImagePreviewDialog(props: CharImagePreviewDialogProps) {
	const { open, charId, charName, variant, updatedAt, onOpenChange } = props
	const { t } = useTranslation()

	const src = `${apiPaths.characters.image(charId, variant)}?v=${updatedAt}`

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				overlayClassName="bg-black/85 transition-none data-open:animate-none data-closed:animate-none"
				className="bg-transparent text-white ring-0 transition-none duration-0 overflow-hidden rounded-none data-open:animate-none data-closed:animate-none sm:data-open:animate-none sm:data-closed:animate-none left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
			>
				<DialogTitle className="sr-only">
					{t("characters.preview.aria", { name: charName, variant })}
				</DialogTitle>
				<DialogBody className="p-0 rounded-none">
					<div className="flex h-full w-full items-center justify-center">
						<img
							src={src}
							alt={charName}
							className="max-h-full max-w-full object-contain"
						/>
					</div>
				</DialogBody>
			</DialogContent>
		</Dialog>
	)
}
