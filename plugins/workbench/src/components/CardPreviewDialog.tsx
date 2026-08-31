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
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>{tw("popover.cardPreviewTitle")}</DialogTitle>
					<DialogDescription>
						{tw("popover.cardPreviewDescription")}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-3 pb-6">
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
