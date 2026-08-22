import type { TFunction } from "i18next"

/**
 * Message count label: floors (threads) and replies count separately —
 * "2 threads · 1 reply" — and either side drops out when it's zero; an
 * empty list yields no label.
 */
export function commentCountLabel(
	floors: number,
	replies: number,
	t: TFunction,
): string {
	const parts: string[] = []
	if (floors > 0) parts.push(t("messages.threadCount", { count: floors }))
	if (replies > 0) parts.push(t("messages.replyCount", { count: replies }))
	return parts.join(" · ")
}
