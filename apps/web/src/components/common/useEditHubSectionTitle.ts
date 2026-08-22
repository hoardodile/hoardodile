import { useTranslation } from "react-i18next"

/**
 * Compose the title for an edit-hub section dialog as
 * `${editHub.title({ name })} · ${section}`. Shared by character and
 * resource section dialogs so the format stays in lock-step.
 */
export function useEditHubSectionTitle(args: {
	readonly hubKey: string
	readonly name: string
	readonly sectionKey: string
}): string {
	const { hubKey, name, sectionKey } = args
	const { t } = useTranslation()
	return `${t(hubKey, { name })} · ${t(sectionKey)}`
}
