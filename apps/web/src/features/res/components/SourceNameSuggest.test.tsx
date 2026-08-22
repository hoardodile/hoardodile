import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { SourceNameSuggest } from "./SourceNameSuggest"

function createMockTrpcClient(
	handlers: Record<string, (input: unknown) => unknown>,
): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async (input: unknown) => {
									const key = `${namespace}.${procedure}`
									const handler = handlers[key]
									if (handler) return handler(input)
									return undefined
								},
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

const sourceNamesHandler = vi.fn((_input?: unknown): unknown[] => [])

beforeEach(() => {
	setTrpcClient(
		createMockTrpcClient({ "resource.sourceNames": sourceNamesHandler }),
	)
	sourceNamesHandler.mockReset()
	sourceNamesHandler.mockImplementation(() => [])
})

async function renderSuggest() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	await act(async () => {
		render(
			<QueryClientProvider client={queryClient}>
				<SourceNameSuggest />
			</QueryClientProvider>,
		)
	})
}

describe("SourceNameSuggest", () => {
	it("renders nothing when no source names exist", async () => {
		await renderSuggest()
		expect(
			document.getElementById("res-source-name-options"),
		).not.toBeInTheDocument()
	})

	it("renders each source name as an option", async () => {
		sourceNamesHandler.mockImplementation(() => [
			{ name: "ExampleSite", count: 3 },
			{ name: "OtherSite", count: 1 },
		])
		await renderSuggest()

		const datalist = await screen.findByTestId("res-source-name-options")
		expect(datalist).toBeInTheDocument()
		const options = Array.from(datalist.querySelectorAll("option")).map(
			(option) => option.getAttribute("value"),
		)
		expect(options).toEqual(["ExampleSite", "OtherSite"])
	})
})
