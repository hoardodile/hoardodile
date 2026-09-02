import type { ResCard as ResCardData } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ImageEditPanel } from "@/components/common/ImageEditPanel"
import { useEditHubSectionTitle } from "@/components/common/useEditHubSectionTitle"
import { useExistingImageSrc } from "@/hooks/useExistingImageSrc"
import { apiPaths } from "@/lib/paths"
import { invalidateResources } from "../api"
import { uploadResCoverCropped } from "../utils/coverCapture"
import { ResCharactersPanel } from "./ResCharsPanel"
import { ResEditPanel } from "./ResEditPanel"

/**
 * Standalone edit dialogs for a resource, opened from the card actions
 * submenu.
 */

function useSectionTitle(name: string, sectionKey: string): string {
	return useEditHubSectionTitle({
		hubKey: "resources.editHub.title",
		name,
		sectionKey,
	})
}

export type ResBasicEditDialogProps = {
	readonly open: boolean
	readonly resource: ResCardData
	readonly onOpenChange: (open: boolean) => void
}

export function ResBasicEditDialog(props: ResBasicEditDialogProps) {
	const { open, resource, onOpenChange } = props
	const { t } = useTranslation()
	const title = useSectionTitle(resource.name, "resources.actions.editBasic")
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			size="md"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<ResEditPanel resource={resource} onSaved={() => onOpenChange(false)} />
		</AppDialog>
	)
}

export type ResCharactersEditDialogProps = {
	readonly open: boolean
	readonly resource: ResCardData
	readonly onOpenChange: (open: boolean) => void
}

export function ResCharactersEditDialog(props: ResCharactersEditDialogProps) {
	const { open, resource, onOpenChange } = props
	const { t } = useTranslation()
	const title = useSectionTitle(
		resource.name,
		"resources.actions.editCharacters",
	)
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			size="xl"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<ResCharactersPanel
				resId={resource.id}
				initialCharacterIds={resource.charIds}
				onSaved={() => onOpenChange(false)}
			/>
		</AppDialog>
	)
}

export type ResCoverEditDialogProps = {
	readonly open: boolean
	readonly resId: string
	readonly resName: string
	readonly onOpenChange: (open: boolean) => void
}

export function ResCoverEditDialog(props: ResCoverEditDialogProps) {
	const { open, resId, resName, onOpenChange } = props
	const { t } = useTranslation()
	const title = useSectionTitle(resName, "resources.actions.editCover")
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			size="lg"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<ResCoverPanel resId={resId} onSaved={() => onOpenChange(false)} />
		</AppDialog>
	)
}

function ResCoverPanel(props: {
	readonly resId: string
	readonly onSaved?: () => void
}) {
	const { resId, onSaved } = props
	const qc = useQueryClient()

	// When a permanent cover already exists, preload it into the cropper so
	// the user can re-crop / fine-tune it without re-picking a file. The
	// `?size=original&format=image` URL returns the uploaded cover only and
	// 404s otherwise (a plugin source-derived frame is not a user upload).
	const existingSrc = useExistingImageSrc(
		`${apiPaths.resources.cover(resId)}?size=original&format=image`,
	)

	async function handleSave(cropped: CroppedImage) {
		await uploadResCoverCropped(resId, cropped, qc)
	}

	return (
		<ImageEditPanel
			mimeType="image/png"
			cropStageWidth={280}
			cropStageHeight={280}
			previewWidth={280}
			previewHeight={280}
			showPreviewSwitch
			initialSrc={existingSrc}
			onSave={handleSave}
			onSaved={onSaved}
			deleteUrl={apiPaths.resources.cover(resId)}
			onInvalidate={async () => invalidateResources(qc, resId)}
			onDeleted={onSaved}
			deleteTestId="resource-cover-delete"
			removeTestId="resource-cover-remove"
		/>
	)
}
