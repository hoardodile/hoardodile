import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { PlatformFilterPage } from "@/components/layout/PlatformFilterPage"
import { ExposureModeSelect } from "@/features/usage/components/ExposureModeSelect"
import { usagePlatformFilterSchema } from "@/features/usage/components/UsagePlatformFilter"
import { UsageStatsPage } from "@/features/usage/components/UsageStatsPage"
import {
	buildStatsSearch,
	type StatsSearchPatch,
} from "@/features/usage/lib/statsSearch"
import { requireAuth } from "@/lib/auth-guard"

const statsSearchSchema = z.object({
	range: z
		.enum(["today", "last7days", "thisWeek", "thisMonth", "thisYear", "all"])
		.default("last7days"),
	platform: usagePlatformFilterSchema.default("all"),
	entityType: z
		.enum(["all", "resource", "character", "document", "plugin"])
		.optional(),
	shareMetric: z.enum(["time", "views"]).default("time"),
	exposureMode: z.enum(["direct", "associated", "total"]).default("direct"),
	sharePage: z.number().int().positive().default(1),
})

export const Route = createFileRoute("/stats")({
	beforeLoad: requireAuth,
	validateSearch: statsSearchSchema,
	component: StatsRoute,
})

function StatsRoute() {
	const { t } = useTranslation()
	const search = Route.useSearch()
	const navigate = useNavigate()

	function updateSearch(patch: StatsSearchPatch): void {
		void navigate({
			to: "/stats",
			search: buildStatsSearch(search, patch),
			replace: true,
			resetScroll: false,
		})
	}

	return (
		<PlatformFilterPage
			title={<span data-testid="stats-heading">{t("usage.title")}</span>}
			description={t("usage.description")}
			platform={search.platform}
			onPlatformChange={(platform) => updateSearch({ platform })}
			extraActions={
				<ExposureModeSelect
					value={search.exposureMode}
					onChange={(exposureMode) => updateSearch({ exposureMode })}
				/>
			}
		>
			<UsageStatsPage search={search} onSearchChange={updateSearch} />
		</PlatformFilterPage>
	)
}
