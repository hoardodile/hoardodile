import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
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

/** The list lives in a dialog now: the row itself is one button. */
async function openDialog() {
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("me-connections-button"))
	return screen.findByTestId("me-connections-dialog")
}

describe("ConnectionsSection", () => {
	it("renders the sign-in list with device, IP and loopback marker", async () => {
		renderSection()
		// The settings row keeps one control; the list is behind it. The
		// control is a plain "View" now — the row's own title says what it
		// opens, so the button does not repeat it.
		expect(
			await screen.findByRole("button", { name: "View" }),
		).toBeInTheDocument()
		const dialog = await openDialog()
		await waitFor(() => {
			expect(within(dialog).getByText("Chrome on Windows")).toBeInTheDocument()
		})
		expect(within(dialog).getByText("192.168.1.50")).toBeInTheDocument()
		expect(within(dialog).getByText("Electron desktop")).toBeInTheDocument()
		expect(within(dialog).getByText("this device")).toBeInTheDocument()
		// The sign-in time is a full date (same-year dates drop the year),
		// not a relative "x minutes ago".
		expect(
			within(dialog).getByText(
				formatDateTime(FIRST_RECORDED_AT, DEFAULT_DATE_FORMAT, "local"),
			),
		).toBeInTheDocument()
		// Fewer than six entries: no pager, one flat list.
		expect(
			within(dialog).queryByTestId("pagination-bar"),
		).not.toBeInTheDocument()
	})

	it("paginates the dialog at five sign-ins with a single pager", async () => {
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
		const dialog = await openDialog()
		await waitFor(() => {
			expect(within(dialog).getByText("Device 1")).toBeInTheDocument()
		})

		// One pager at the bottom with the count label.
		expect(within(dialog).getAllByTestId("pagination-bar")).toHaveLength(1)
		expect(within(dialog).getByText("7 sign-ins")).toBeInTheDocument()
		// First page: five rows, the rest hidden.
		expect(within(dialog).getByText("Device 5")).toBeInTheDocument()
		expect(within(dialog).queryByText("Device 6")).toBeNull()

		await user.click(within(dialog).getByRole("button", { name: "2" }))

		expect(within(dialog).getByText("Device 6")).toBeInTheDocument()
		expect(within(dialog).getByText("Device 7")).toBeInTheDocument()
		expect(within(dialog).queryByText("Device 1")).toBeNull()
	})

	it("renders an empty state without sign-ins", async () => {
		setTrpcClient(
			createMockTrpcClient({
				"access.connections": () => ({ connections: [] }),
			}),
		)
		renderSection()
		const dialog = await openDialog()
		expect(within(dialog).getByText("No sign-ins yet.")).toBeInTheDocument()
	})
})
