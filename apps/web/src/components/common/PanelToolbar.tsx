import { MAX_SEARCH_QUERY_LENGTH } from "@hoardodile/schemas"
import {
	PanelToolbar as PanelToolbarShell,
	type PanelToolbarProps as PanelToolbarShellProps,
} from "@hoardodile/ui/components/panel-toolbar"
import { useTranslation } from "react-i18next"

export type PanelToolbarProps = Omit<
	PanelToolbarShellProps,
	"unusedLabel" | "reorderLabel" | "addLabel" | "maxLength"
> & {
	/** Add button label — defaults to the localized "Add". */
	addLabel?: string
	/** Unused chip label — defaults to the localized "Unused". */
	unusedLabel?: string
	/** Reorder chip label — defaults to the localized "Reorder". */
	reorderLabel?: string
}

/**
 * The app-wired {@link PanelToolbar} shell: the localized chip labels and
 * the search-query length cap live here, everything else passes through
 * to `@hoardodile/ui/components/panel-toolbar`.
 */
export function PanelToolbar(props: PanelToolbarProps) {
	const { addLabel, unusedLabel, reorderLabel, ...rest } = props
	const { t } = useTranslation()
	return (
		<PanelToolbarShell
			{...rest}
			addLabel={addLabel ?? t("me.custom.add")}
			unusedLabel={unusedLabel ?? t("me.custom.unused")}
			reorderLabel={reorderLabel ?? t("me.custom.reorder")}
			maxLength={MAX_SEARCH_QUERY_LENGTH}
		/>
	)
}
