import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MarketplacePageActions } from "./MarketplacePageActions"

const { mockClient } = vi.hoisted(() => ({
	mockClient: {} as {
		marketplace: { readonly [k in string]: unknown }
	},
}))

vi.mock("@/trpc/client", () => ({
	getTrpcClient: () => mockClient,
}))

function installClient(config?: { readonly registryRepo: string | null }) {
	mockClient.marketplace = {
		getConfig: {
			query: vi.fn(async () => config ?? { registryRepo: null }),
		},
		setConfig: { mutate: vi.fn(async () => {}) },
	}
}

function renderActions() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	render(
		<QueryClientProvider client={queryClient}>
			<MarketplacePageActions />
		</QueryClientProvider>,
	)
}

const user = { click: async (el: Element) => fireEvent.click(el) }

beforeEach(() => {
	vi.restoreAllMocks()
})

describe("MarketplacePageActions", () => {
	it("configures the registry through the page-level dialog", async () => {
		installClient()
		renderActions()

		await user.click(await screen.findByTestId("marketplace-registry-config"))
		const input = await screen.findByTestId("marketplace-registry-input")
		fireEvent.change(input, { target: { value: "me/registry" } })
		await user.click(screen.getByTestId("marketplace-registry-save"))

		await waitFor(() => {
			expect(
				(
					mockClient.marketplace.setConfig as {
						mutate: ReturnType<typeof vi.fn>
					}
				).mutate,
			).toHaveBeenCalledWith({ registryRepo: "me/registry" })
		})
	})
})
