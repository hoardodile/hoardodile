import { useQuery } from "@tanstack/react-query"
import { pluginListAllQueryOptions } from "@/features/plugin/pluginApi"
import { marketUpdateAvailable } from "./compat"
import {
	marketplaceConfigQueryOptions,
	marketplaceSnapshotQueryOptions,
} from "./marketplaceApi"

/**
 * Installed marketplace plugins with a compatible newer release — the
 * sidebar badge source. Shares the snapshot query key with the
 * marketplace page, so the badge and the catalog never double-fetch.
 * Disabled or failed → 0 (the badge stays silent — no toast, no dot).
 */
export function useMarketplaceUpdateCount(): number {
	const configQuery = useQuery(marketplaceConfigQueryOptions())
	const registryRepo = configQuery.data?.registryRepo ?? null
	const snapshotQuery = useQuery({
		...marketplaceSnapshotQueryOptions(),
		enabled: registryRepo !== null,
	})
	const installedQuery = useQuery(pluginListAllQueryOptions())
	const installedById = new Map(
		(installedQuery.data ?? []).map((row) => [row.id, row]),
	)
	return (snapshotQuery.data?.plugins ?? []).reduce(
		(count, plugin) =>
			marketUpdateAvailable(
				plugin,
				installedById.get(plugin.id)?.manifest.version,
			)
				? count + 1
				: count,
		0,
	)
}
