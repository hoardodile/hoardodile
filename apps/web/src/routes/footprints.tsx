import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { PlatformFilterPage } from "@/components/layout/PlatformFilterPage"
import { TraceTimelinePage } from "@/features/trace/components/TraceTimelinePage"
import {
	type UsagePlatformFilterValue,
	usagePlatformFilterSchema,
} from "@/features/usage/components/UsagePlatformFilter"
import { requireAuth } from "@/lib/auth-guard"

const footprintsSearchSchema = z.object({
	platform: usagePlatformFilterSchema.default("all"),
})

export const Route = createFileRoute("/footprints")({
	beforeLoad: requireAuth,
	validateSearch: footprintsSearchSchema,
	component: FootprintsRoute,
})

function FootprintsRoute() {
	const { t } = useTranslation()
	const search = Route.useSearch()
	const navigate = useNavigate()

	function updatePlatform(platform: UsagePlatformFilterValue): void {
		void navigate({
			to: "/footprints",
			search: { ...search, platform },
			replace: true,
			resetScroll: false,
		})
	}

	return (
		<PlatformFilterPage
			title={<span data-testid="footprints-heading">{t("trace.title")}</span>}
			description={t("trace.description")}
			platform={search.platform}
			onPlatformChange={updatePlatform}
		>
			<TraceTimelinePage platform={search.platform} />
		</PlatformFilterPage>
	)
}
