import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import {
	Checklist,
	MoveToFolder,
	Pin,
	Upload,
} from "@hoardodile/ui/icons/registry"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { PinnedSectionSettingsDialog } from "@/features/overview/pinned/PinnedSectionSettingsDialog"
import { pinnedSectionListCodec } from "@/features/overview/pinned/pinnedSectionListCodec"
import type {
	PinnedFilterConfig,
	PinnedSectionItem,
} from "@/features/overview/pinned/types"
import { ResSearchRouted } from "@/features/res"
import {
	RESOURCE_SEARCH_DEFAULTS,
	resSearchUrlSchema,
} from "@/features/res/utils/searchState"
import { usePrefSync } from "@/hooks/usePrefSync"
import { useRouteSearchState } from "@/hooks/useRouteSearchState"
import { requireAuth } from "@/lib/auth-guard"
import { prefKeys } from "@/lib/keys"

export const Route = createFileRoute("/resources/")({
	beforeLoad: requireAuth,
	validateSearch: resSearchUrlSchema,
	pendingMs: Number.POSITIVE_INFINITY,
	component: ResourcesListRoute,
})

function ResourcesListRoute() {
	const { t } = useTranslation()
	const [bulkSelectMode, setBulkSelectMode] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [searchState] = useRouteSearchState(RESOURCE_SEARCH_DEFAULTS)
	const { charId } = Route.useSearch()

	const [pinnedItems, setPinnedItems] = usePrefSync(
		prefKeys.overviewPinnedResources,
		[] as readonly PinnedSectionItem[],
		pinnedSectionListCodec,
	)

	const currentFilters: PinnedFilterConfig = {
		query: searchState.query,
		tagIds: searchState.tagIds,
		tagMode: searchState.tagMode,
		noCharacters: searchState.noCharacters,
		contentPluginId:
			searchState.contentPluginId === ""
				? undefined
				: searchState.contentPluginId,
		searchMetaFacets:
			Object.keys(searchState.searchMetaFacets).length > 0
				? searchState.searchMetaFacets
				: undefined,
		searchIntro: searchState.searchIntro,
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
			    header row is actions: selection & pinning left, import right. */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={() => setSettingsOpen(true)}
						data-testid="resource-pin-overview-settings"
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
						data-testid="resource-bulk-mode-toggle"
					>
						<Icon icon={Checklist} />
						{t("resources.bulk.select")}
					</Button>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						data-testid="open-import-resources"
						nativeButton={false}
						variant="secondary"
						render={
							<Link to="/resources/import">
								<Icon icon={MoveToFolder} />
								{t("resources.import.action")}
							</Link>
						}
					/>
					<Button
						data-testid="open-create-resource"
						nativeButton={false}
						variant="default"
						render={
							<Link to="/resources/new">
								<Icon icon={Upload} />
								{t("resources.upload")}
							</Link>
						}
					/>
				</div>
			</div>
			<div className="mt-6">
				<ResSearchRouted
					charId={charId}
					bulkSelectMode={bulkSelectMode}
					onBulkSelectModeChange={setBulkSelectMode}
				/>
			</div>
			<PinnedSectionSettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				sectionTitle={t("resources.title")}
				entityType="resource"
				items={pinnedItems}
				currentFilters={currentFilters}
				onChange={handleSave}
			/>
		</PageScaffold>
	)
}
