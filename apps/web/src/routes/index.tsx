import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { OverviewDashboard } from "@/features/overview/OverviewDashboard"
import { requireAuth } from "@/lib/auth-guard"
import { consumeLastRouteRestore } from "@/lib/last-route"

export const Route = createFileRoute("/")({
	beforeLoad: async (args) => {
		await requireAuth(args)
		// Desktop reopen continuity (see lib/last-route): the first
		// authenticated match on `/` — a cold start with a live session,
		// or the hop after signing in — redirects to the page the user
		// was on. Consumed once, so later "Home" clicks never bounce.
		const last = consumeLastRouteRestore()
		if (last === undefined || last === args.location.href) return
		throw redirect({ href: last })
	},
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
