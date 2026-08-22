import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { createFileRoute } from "@tanstack/react-router"
import { OverviewDashboard } from "@/features/overview/OverviewDashboard"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/")({
	beforeLoad: requireAuth,
	component: OverviewRoute,
})

/**
 * Overview route: action hub for search, continue watching, pinned content,
 * and recent activity across the library.
 */
function OverviewRoute() {
	return (
		<PageScaffold width="content">
			<OverviewDashboard />
		</PageScaffold>
	)
}
