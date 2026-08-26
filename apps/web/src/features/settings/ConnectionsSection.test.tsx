import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it } from "vitest"
import {
	DEFAULT_DATE_FORMAT,
	formatDateTime,
} from "@/features/settings/datePrefs"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { ConnectionsSection } from "./ConnectionsSection"

const FIRST_RECORDED_AT = Date.now() - 60_000

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
						recordedAt: FIRST_RECORDED_AT,
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
		// The sign-in time is a full date (same-year dates drop the year),
		// not a relative "x minutes ago".
		expect(
			screen.getByText(
				formatDateTime(FIRST_RECORDED_AT, DEFAULT_DATE_FORMAT, "local"),
			),
		).toBeInTheDocument()
		// Fewer than six entries: no pager, one flat list.
		expect(screen.queryByTestId("pagination-bar")).toBeNull()
	})

	it("paginates above and below when there are more than five sign-ins", async () => {
		setTrpcClient(
			createMockTrpcClient({
				"access.connections": () => ({
					connections: Array.from({ length: 7 }, (_, index) => ({
						id: `session-${index + 1}`,
						ip: `192.168.1.${index + 1}`,
						origin: "lan",
						deviceLabel: `Device ${index + 1}`,
						recordedAt: Date.now() - index * 60_000,
					})),
				}),
			}),
		)
		const user = userEvent.setup()
		renderSection()
		await waitFor(() => {
			expect(screen.getByText("Device 1")).toBeInTheDocument()
		})

		// One pager below the list with the count label.
		expect(screen.getAllByTestId("pagination-bar")).toHaveLength(1)
		expect(screen.getByText("7 sign-ins")).toBeInTheDocument()
		// First page: five rows, the rest hidden.
		expect(screen.getByText("Device 5")).toBeInTheDocument()
		expect(screen.queryByText("Device 6")).toBeNull()

		await user.click(screen.getByRole("button", { name: "2" }))

		expect(screen.getByText("Device 6")).toBeInTheDocument()
		expect(screen.getByText("Device 7")).toBeInTheDocument()
		expect(screen.queryByText("Device 1")).toBeNull()
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
