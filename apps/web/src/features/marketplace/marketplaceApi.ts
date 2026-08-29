import type { UseMutationOptions } from "@tanstack/react-query"
import { apiFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutation, trpcQuery, trpcQueryOptions } from "@/trpc/factory"

export const marketplaceKeys = {
	all: ["marketplace"] as const,
	config: () => [...marketplaceKeys.all, "config"] as const,
	snapshot: () => [...marketplaceKeys.all, "snapshot"] as const,
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
