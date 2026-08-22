import { Gallery } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { CommentsSection } from "@/features/comments"
import { LinkedDocumentsSection } from "@/features/doc/components/LinkedDocumentsSection"
import {
	MarqueeChevrons,
	type MarqueeHandle,
} from "@/features/overview/components/Marquee"
import { OverviewSectionCard } from "@/features/overview/components/OverviewSectionCard"
import { ResCardMarqueeStrip } from "@/features/overview/components/ResCardMarqueeStrip"
import { SectionTitle } from "@/features/overview/components/SectionTitle"
import { resListCardsQueryOptions } from "@/features/res"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/characters/$id/")({
	beforeLoad: requireAuth,
	component: CharOverview,
})

const RECENT_RESOURCE_LIMIT = 3
const THUMB_HEIGHT_PX = 240

/**
 * Overview tab for a character. The right sidebar (fullbody
 * illustration, traits, tag groups) belongs to the `/characters/$id`
 * layout — see `$id.tsx`. This tab only owns the main column: linked
 * documents as an unbordered title grid, the most recently updated
 * resources as a stepping marquee strip, and a comments section scoped
 * by `charId`. Relationships live in the hero.
 *
 * Each section owns its own query subscription so the page renders
 * progressively — sections with cached data appear immediately while
 * slower probes (recents) show their own placeholders.
 */
function CharOverview() {
	const { id } = Route.useParams()
	return (
		<div className="flex flex-col gap-8">
			<LinkedDocumentsSection
				titleKey="characters.detail.documentsTitle"
				charIds={[id]}
			/>
			<RecentResourcesSection charId={id} />
			<CommentsSection
				variant="embedded"
				context={{ kind: "char", id }}
				testId="character-overview-comments"
			/>
		</div>
	)
}

function RecentResourcesSection({ charId }: { readonly charId: string }) {
	const { t } = useTranslation()
	const stripRef = useRef<MarqueeHandle>(null)
	const listQ = useQuery(
		resListCardsQueryOptions({
			query: "",
			page: 1,
			charIds: [charId],
			sortBy: "updated",
			order: "desc",
		}),
	)
	const rows = (listQ.data?.rows ?? []).slice(0, RECENT_RESOURCE_LIMIT)
	const total = listQ.data?.total
	if (!listQ.isPending && rows.length === 0) return null
	// The overview's section anatomy — the same borderless header the
	// pinned sections ride, so nothing is rewritten for the detail page.
	return (
		<OverviewSectionCard
			title={
				<SectionTitle
					icon={Gallery}
					title={t("characters.detail.recent")}
					count={total}
					controls={<MarqueeChevrons stripRef={stripRef} />}
				/>
			}
			action={
				// The full listing lives on the resources index, which opens
				// with this character pre-applied as a filter.
				<Link
					to="/resources"
					search={{ charId }}
					className="text-xs text-muted-foreground transition-colors hover:text-secondary-foreground"
				>
					{t("characters.detail.viewAllResources")}
				</Link>
			}
			data-testid="character-overview-recent"
		>
			<ResCardMarqueeStrip
				rows={rows}
				isPending={listQ.isPending}
				stripRef={stripRef}
				thumbHeightPx={THUMB_HEIGHT_PX}
				skeletonCount={RECENT_RESOURCE_LIMIT}
			/>
		</OverviewSectionCard>
	)
}
