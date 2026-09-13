import type { UseMutationOptions } from "@tanstack/react-query"
import { apiFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation, trpcQuery, trpcQueryOptions } from "@/trpc/factory"

export const marketplaceKeys = {
	all: ["marketplace"] as const,
	config: () => [...marketplaceKeys.all, "config"] as const,
	snapshot: () => [...marketplaceKeys.all, "snapshot"] as const,
	detail: (repo: string) => [...marketplaceKeys.all, "detail", repo] as const,
}

export function marketplaceConfigQueryOptions() {
	return trpcQueryOptions({
		namespace: "marketplace",
		procedure: "getConfig",
		input: undefined,
		queryKey: marketplaceKeys.config(),
		staleTime: 30_000,
	})
}

export function marketplaceSetConfigMutation() {
	return trpcMutation("marketplace", "setConfig")
}

/**
 * Catalog snapshot. The server answers from its cached snapshot (default
 * window: a day) unless it has none; the refresh button calls with
 * `{ force: true }` (see {@link marketplaceRefreshMutation}) and writes
 * the result into the same query key. The client never retries — the
 * catalog is fetched once on page open, and a failed fetch stays failed
 * until the user refreshes.
 */
export function marketplaceSnapshotQueryOptions() {
	return {
		...trpcQueryOptions({
			namespace: "marketplace",
			procedure: "snapshot",
			input: { force: false },
			queryKey: marketplaceKeys.snapshot(),
			staleTime: 5 * 60_000,
		}),
		retry: false,
		refetchOnWindowFocus: false,
	}
}

type MarketSnapshot = RouterOutputs["marketplace"]["snapshot"]

/**
 * One plugin's authoritative latest release (asset / notes / readme /
 * sha256), requested when the user opens its "View" dialog. The server
 * assembles it from quota-free GitHub web endpoints (atom feed +
 * `releases/expanded_assets`), on demand — the list snapshot only ever
 * reads the free feed, and the built payload is cached per repo on the
 * server for the same window.
 *
 * The `staleTime` is the whole policy: a fresh entry is reused when the
 * dialog is reopened, and only after a day does opening it re-ask. That
 * keeps GitHub traffic to roughly one check per plugin per day (the free
 * web endpoints are rate-limited), while {@link marketplaceDetailRefresh}
 * gives the user an explicit "check now" for the case where they know a
 * release just landed.
 */
export const MARKETPLACE_DETAIL_STALE_MS = 24 * 60 * 60_000

export function marketplaceDetailQueryOptions(repo: string, id: string) {
	return trpcQueryOptions({
		namespace: "marketplace",
		procedure: "detail",
		input: { id, repo },
		queryKey: marketplaceKeys.detail(repo),
		staleTime: MARKETPLACE_DETAIL_STALE_MS,
	})
}

/**
 * The detail dialog's refresh button: re-checks this plugin's release
 * against the GitHub web endpoints, bypassing both the day-old query entry
 * and the server's release cache. The result is written into the shared
 * detail key by the caller, so the catalog's version line updates with it.
 * A rate-limited pass still answers from cache (flagged) rather than
 * failing the view.
 */
export function marketplaceDetailRefresh(input: {
	readonly id: string
	readonly repo: string
}): Promise<RouterOutputs["marketplace"]["detail"]> {
	return trpcQuery("marketplace", "detail", {
		id: input.id,
		repo: input.repo,
		force: true,
	})
}

/** Explicit "refresh now" — bypasses the server cache and the query cache. */
export function marketplaceRefreshMutation(): UseMutationOptions<
	MarketSnapshot,
	Error,
	void
> {
	return {
		mutationFn: () => trpcQuery("marketplace", "snapshot", { force: true }),
	}
}

/** Install/update a plugin from its published release asset (HTTP — long-running). */
export async function marketplaceInstall(input: {
	readonly id: string
	/** Source repo the plugin is installed from — recorded by the server
	    so updates stay detectable after a registry switch. */
	readonly repo: string
	readonly assetUrl: string
	readonly sha256?: string
}): Promise<void> {
	const resp = await apiFetch(apiPaths.pluginMarketplace.install(), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(120_000),
	})
	if (!resp.ok) {
		const text = await resp.text().catch(() => "")
		throw new Error(text || `plugin install failed (${resp.status})`)
	}
}
