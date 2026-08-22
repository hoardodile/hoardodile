import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { PlatformFilterPage } from "@/components/layout/PlatformFilterPage"
import { UsageHistoryPage } from "@/features/usage/components/UsageHistoryPage"
import {
	type UsagePlatformFilterValue,
	usagePlatformFilterSchema,
} from "@/features/usage/components/UsagePlatformFilter"
import { requireAuth } from "@/lib/auth-guard"

const usageHistorySearchSchema = z.object({
	platform: usagePlatformFilterSchema.default("all"),
})

export const Route = createFileRoute("/usage")({
	beforeLoad: requireAuth,
	validateSearch: usageHistorySearchSchema,
	component: UsageRoute,
})

function UsageRoute() {
	const { t } = useTranslation()
	const search = Route.useSearch()
	const navigate = useNavigate()

	function updatePlatform(platform: UsagePlatformFilterValue): void {
		void navigate({
			to: "/usage",
			search: { ...search, platform },
			replace: true,
			resetScroll: false,
		})
	}

	return (
		<PlatformFilterPage
			title={
				<span data-testid="usage-history-heading">
					{t("usage.history.title")}
				</span>
			}
			description={t("usage.history.description")}
			platform={search.platform}
			onPlatformChange={updatePlatform}
		>
			<UsageHistoryPage platform={search.platform} />
		</PlatformFilterPage>
	)
}
