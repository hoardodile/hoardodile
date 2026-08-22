import { traitFilter } from "@hoardodile/schemas"
import { sortBy } from "@hoardodile/shared"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { Add } from "@hoardodile/ui/icons/actions"
import { Checklist, Pin } from "@hoardodile/ui/icons/registry"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { CHARACTER_SEARCH_DEFAULTS, CharSearchRouted } from "@/features/char"
import { PinnedSectionSettingsDialog } from "@/features/overview/pinned/PinnedSectionSettingsDialog"
import { pinnedSectionListCodec } from "@/features/overview/pinned/pinnedSectionListCodec"
import type {
	PinnedFilterConfig,
	PinnedSectionItem,
} from "@/features/overview/pinned/types"
import { usePrefSync } from "@/hooks/usePrefSync"
import { useRouteSearchState } from "@/hooks/useRouteSearchState"
import { requireAuth } from "@/lib/auth-guard"
import { prefKeys } from "@/lib/keys"

const charsSearchSchema = z
	.object({
		query: z.string().optional(),
		page: z.coerce.number().int().min(1).optional(),
		tagIds: z.array(z.string()).optional(),
		tagMode: z.enum(["and", "or", "not", "nor"]).optional(),
		sortBy: sortBy.optional(),
		order: z.enum(["asc", "desc"]).optional(),
		random: z.coerce.boolean().optional(),
		showOnlySelected: z.coerce.boolean().optional(),
		trash: z.coerce.boolean().optional(),
		searchIntro: z.coerce.boolean().optional(),
		traitFilters: z.array(traitFilter).optional(),
		relationshipTypeIds: z.array(z.string()).optional(),
	})
	.loose()

export const Route = createFileRoute("/characters/")({
	beforeLoad: requireAuth,
	validateSearch: charsSearchSchema,
	component: CharsListRoute,
})

function CharsListRoute() {
	const [bulkSelectMode, setBulkSelectMode] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const { t } = useTranslation()
	const [searchState] = useRouteSearchState(CHARACTER_SEARCH_DEFAULTS)

	const [pinnedItems, setPinnedItems] = usePrefSync(
		prefKeys.overviewPinnedCharacters,
		[] as readonly PinnedSectionItem[],
		pinnedSectionListCodec,
	)

	const currentFilters: PinnedFilterConfig = {
		query: searchState.query,
		tagIds: searchState.tagIds,
		tagMode: searchState.tagMode,
		traitFilters: searchState.traitFilters,
		searchIntro: searchState.searchIntro,
		relationshipTypeIds: searchState.relationshipTypeIds,
		sortBy: searchState.sortBy,
		order: searchState.order,
		random: searchState.random,
	}

	function handleSave(nextItems: readonly PinnedSectionItem[]) {
		setPinnedItems(nextItems)
	}

	return (
		<PageScaffold width="content">
			{/* No page title — the sidebar already says where you are. The
			    header row is actions: selection & pinning left, create right. */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={() => setSettingsOpen(true)}
						data-testid="character-pin-overview-settings"
					>
						<Icon icon={Pin} />
						{t("appShell.nav.overview")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						active={bulkSelectMode}
						aria-pressed={bulkSelectMode}
						onClick={() => setBulkSelectMode((on) => !on)}
						data-testid="character-bulk-mode-toggle"
					>
						<Icon icon={Checklist} />
						{t("characters.bulk.select")}
					</Button>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						data-testid="new-character"
						nativeButton={false}
						render={
							<Link to="/characters/new">
								<Icon icon={Add} />
								{t("characters.new")}
							</Link>
						}
					/>
				</div>
			</div>
			<div className="mt-6">
				<CharSearchRouted
					bulkSelectMode={bulkSelectMode}
					onBulkSelectModeChange={setBulkSelectMode}
				/>
			</div>
			<PinnedSectionSettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				sectionTitle={t("characters.title")}
				entityType="character"
				items={pinnedItems}
				currentFilters={currentFilters}
				onChange={handleSave}
			/>
		</PageScaffold>
	)
}
