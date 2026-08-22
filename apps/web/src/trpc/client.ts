import type { AppRouter } from "@hoardodile/server/router"
import { QueryClient } from "@tanstack/react-query"
import { createTRPCClient, httpBatchLink } from "@trpc/client"
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query"
import { detectPlatform } from "@/features/usage/detectPlatform"
import { credentialedFetch } from "@/lib/http"

export function createTrpcClient() {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: "/trpc",
				fetch: credentialedFetch,
				// Tag every request with the client's platform so the server
				// can attribute recorded footprints to this device.
				headers: () => ({ "x-platform": detectPlatform() }),
			}),
		],
	})
}

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// LAN clients occasionally hit transient WiFi/NAT dropouts
				// (10-30 s). Two retries with exponential backoff (1 s → 2 s)
				// absorb single-packet failures without surfacing an error
				// banner for every blip.
				retry: 2,
				// After the browser detects network recovery (online event),
				// refetch all active queries so the UI reflects any server
				// mutations that landed during the outage.
				refetchOnReconnect: true,
				refetchOnWindowFocus: false,
				staleTime: 5_000,
			},
		},
	})
}

export type TRPCClient = ReturnType<typeof createTrpcClient>

export function createTrpc(client: TRPCClient, queryClient: QueryClient) {
	return createTRPCOptionsProxy<AppRouter>({ client, queryClient })
}

export type TRPC = ReturnType<typeof createTrpc>

/**
 * Module-scoped tRPC client. Populated exactly once from {@link main} so
 * feature queries / mutations can reach the server without threading the
 * client through React props or router context. Tests swap it via
 * {@link setTrpcClient}.
 */
let activeTrpcClient: TRPCClient | undefined

export function setTrpcClient(client: TRPCClient): void {
	activeTrpcClient = client
}

/** @throws when the client has not been initialised. */
export function getTrpcClient(): TRPCClient {
	if (activeTrpcClient === undefined) {
		throw new Error("tRPC client not initialised; call setTrpcClient first")
	}
	return activeTrpcClient
}

// ── Contract types (merged from former contract.ts) ──────────────────────────

import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server"

/**
 * Inferred map of every procedure's **input** type, keyed by router path.
 *
 * @example
 *   type CreateInput = RouterInputs["character"]["create"]
 *   type ListInput   = RouterInputs["resource"]["list"]
 */
export type RouterInputs = inferRouterInputs<AppRouter>

/**
 * Inferred map of every procedure's **output** type, keyed by router path.
 *
 * @example
 *   type Character = RouterOutputs["character"]["detail"]
 *   type ListPage  = RouterOutputs["resource"]["list"]
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>
