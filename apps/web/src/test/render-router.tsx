import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router"
import { render } from "@testing-library/react"

import { ThemeProvider } from "@/components/common/ThemeProvider"
import { routeTree } from "@/routeTree.gen"
import { createTrpc, createTrpcClient } from "@/trpc/client"

export type RenderRouterOptions = {
	initialEntries?: string[]
}

export function renderRouter({
	initialEntries = ["/"],
}: RenderRouterOptions = {}) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: 0,
				gcTime: 0,
				refetchOnWindowFocus: false,
			},
			mutations: { retry: false },
		},
	})
	const trpcClient = createTrpcClient()
	const trpc = createTrpc(trpcClient, queryClient)

	const router = createRouter({
		routeTree,
		context: { queryClient, trpc },
		history: createMemoryHistory({ initialEntries }),
		defaultPendingMs: 0,
	})

	const utils = render(
		<ThemeProvider>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ThemeProvider>,
	)

	return { ...utils, router, queryClient }
}
