import { QueryClient } from "@tanstack/react-query"
import { createMemoryHistory, createRouter } from "@tanstack/react-router"
import { beforeEach, describe, expect, it } from "vitest"
import { routeTree } from "@/routeTree.gen"
import { createTrpc, createTrpcClient } from "@/trpc/client"
import { collectRoutePaths } from "./appRoutes"

/**
 * Smoke test against the real generated route tree (jsdom: the route
 * modules pull in feature code). Guards the desktop shell allowlist —
 * if this fails, the shell would refuse same-window navigation to a route.
 *
 * Route objects expose `fullPath` via a lazy getter that `createRouter`
 * fills in during init, so collect the patterns the same way the app does:
 * right after router creation.
 */
describe("collectRoutePaths against routeTree.gen", () => {
	let paths: string[] | undefined

	beforeEach(() => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false, staleTime: 0, gcTime: 0 },
				mutations: { retry: false },
			},
		})
		const trpcClient = createTrpcClient()
		createRouter({
			routeTree,
			context: { queryClient, trpc: createTrpc(trpcClient, queryClient) },
			history: createMemoryHistory({ initialEntries: ["/"] }),
			defaultPendingMs: 0,
		})
		paths = collectRoutePaths(routeTree)
	})

	it("yields the app's routes, folded and deduped", () => {
		expect(paths!.length).toBeGreaterThan(20)
		expect(new Set(paths).size).toBe(paths!.length)
		expect(paths!.filter((path) => path.endsWith("/") && path !== "/")).toEqual(
			[],
		)
		for (const expected of [
			"/",
			"/login",
			"/characters",
			"/characters/$id",
			"/characters/new",
			"/documents/$id",
			"/resources",
			"/resources/$id",
			"/resources/import",
			"/settings/about",
			"/settings/data",
			"/settings/desktop",
		]) {
			expect(paths).toContain(expected)
		}
	})
})
