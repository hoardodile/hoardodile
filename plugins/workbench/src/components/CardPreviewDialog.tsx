import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { useTranslation } from "react-i18next"
import type {
	ResourceContext,
	WorkbenchManifest,
	WorkbenchResource,
} from "../context.ts"
import { ResCardPreview } from "./ResCardPreview.tsx"

/**
 * Resource-card dialog (opened from the menu bar): a simulated res card —
 * real generated cover + the plugin's `manifest.ui.card` templates + the
 * hook snapshot metadata — so the dev can walk the metadata → cover →
 * card pipeline offline.
 */
export function CardPreviewDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly manifest: WorkbenchManifest | null
	readonly resource: WorkbenchResource | undefined
	readonly ctx: ResourceContext | null
	readonly locale: string
}) {
	const { open, onOpenChange, manifest, resource, ctx, locale } = props
	const { t: tw } = useTranslation("workbench")

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* `max-w-md` gives the body the 400px the app card can reach at
			    its widest, so a wide cover is previewed at its real size. */}
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{tw("popover.cardPreviewTitle")}</DialogTitle>
					<DialogDescription>
						{tw("popover.cardPreviewDescription")}
					</DialogDescription>
				</DialogHeader>
				{/* `items-center` centres the card in the body: the card is as
				    wide as its cover box, so left-aligning it would pin the
				    preview (and its metadata) to the dialog's edge. */}
				<DialogBody className="flex flex-col items-center gap-3 pb-6">
					{manifest !== null && resource !== undefined && ctx !== null ? (
						<ResCardPreview
							manifest={manifest}
							resource={resource}
							snapshot={ctx.snapshot}
							locale={locale}
						/>
					) : null}
				</DialogBody>
			</DialogContent>
		</Dialog>
	)
}
