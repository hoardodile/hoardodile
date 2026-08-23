import { useTranslation } from "react-i18next"
import { loose } from "@/i18n"

/**
 * Compose the title for an edit-hub section dialog as
 * `${editHub.title({ name })} · ${section}`. Shared by character and
 * resource section dialogs so the format stays in lock-step. The two key
 * parameters are assembled by callers from entity-specific literals.
 */
export function useEditHubSectionTitle(args: {
	readonly hubKey: string
	readonly name: string
	readonly sectionKey: string
}): string {
	const { hubKey, name, sectionKey } = args
	const { t } = useTranslation()
	return `${loose(t)(hubKey, { name })} · ${loose(t)(sectionKey)}`
}
