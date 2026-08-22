import {
	ImageCropPanel as ImageCropPanelShell,
	type ImageCropPanelProps as ImageCropPanelShellProps,
} from "@hoardodile/ui/components/image-crop-panel"
import { useTranslation } from "react-i18next"

export type ImageCropPanelProps = Omit<ImageCropPanelShellProps, "labels">

/**
 * The app-wired {@link ImageCropPanel} shell: the localized chrome (pick
 * hint, reselect, preview and save/remove labels) lives here, everything
 * else passes through to `@hoardodile/ui/components/image-crop-panel`.
 */
export function ImageCropPanel(props: ImageCropPanelProps) {
	const { t } = useTranslation()
	return (
		<ImageCropPanelShell
			{...props}
			labels={{
				saving: t("common.saving"),
				remove: t("common.remove"),
				save: t("common.save"),
				pickHint: t("imageCrop.pickHint"),
				reselect: t("imageCrop.reselect"),
				previewLabel: t("imageCrop.previewLabel"),
				previewAlt: t("imageCrop.previewAlt"),
				showPreview: t("imageCrop.showPreview"),
				saveFailed: t("imageCrop.saveFailed"),
			}}
		/>
	)
}
