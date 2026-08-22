import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import dayjs from "@/lib/dayjs"

/**
 * Locale-aware relative time ("2 hours ago" / "2 小时前"). The locale follows
 * the active i18n language and is applied per dayjs instance, so the global
 * dayjs locale is never mutated.
 */
export function useRelativeTime(): (ts: number) => string {
	const { i18n } = useTranslation()
	const locale = i18n.language.startsWith("zh") ? "zh-cn" : "en"
	return useCallback(
		(ts: number) => dayjs(ts).locale(locale).fromNow(),
		[locale],
	)
}
