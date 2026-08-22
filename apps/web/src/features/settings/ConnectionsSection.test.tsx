import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { ConnectionsSection } from "./ConnectionsSection"

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

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"access.connections": () => ({
				connections: [
					{
						id: "session-1",
						ip: "192.168.1.50",
						origin: "lan",
						deviceLabel: "Chrome on Windows",
						recordedAt: Date.now() - 60_000,
					},
					{
						id: "session-2",
						ip: "127.0.0.1",
						origin: "loopback",
						deviceLabel: "Electron desktop",
						recordedAt: Date.now() - 3_600_000,
					},
				],
			}),
		}),
	)
})

function renderSection() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ConnectionsSection />
		</QueryClientProvider>,
	)
}

describe("ConnectionsSection", () => {
	it("renders the sign-in list with device, IP and loopback marker", async () => {
		renderSection()
		await waitFor(() => {
			expect(screen.getByText("Chrome on Windows")).toBeInTheDocument()
		})
		expect(screen.getByText("192.168.1.50")).toBeInTheDocument()
		expect(screen.getByText("Electron desktop")).toBeInTheDocument()
		expect(screen.getByText("this device")).toBeInTheDocument()
	})

	it("renders an empty state without sign-ins", async () => {
		setTrpcClient(
			createMockTrpcClient({
				"access.connections": () => ({ connections: [] }),
			}),
		)
		renderSection()
		await waitFor(() => {
			expect(screen.getByText("No sign-ins yet.")).toBeInTheDocument()
		})
	})
})
