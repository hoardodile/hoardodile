import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { SearchResultsPage } from "@/features/search/components/SearchResultsPage"
import { requireAuth } from "@/lib/auth-guard"

const searchRouteSchema = z.object({
	query: z.string().optional(),
	imageSearch: z.string().optional(),
})

export const Route = createFileRoute("/search")({
	beforeLoad: requireAuth,
	validateSearch: searchRouteSchema,
	component: SearchRoute,
})

function SearchRoute() {
	return (
		<PageScaffold width="content">
			<SearchResultsPage />
		</PageScaffold>
	)
}
