import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it } from "vitest"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { NetworkSection } from "./NetworkSection"

type NetworkInfo = {
	source: "explicit" | "env" | "system" | "none"
	httpHost: string | null
	httpsHost: string | null
	bypassCount: number
}

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

function installClient(info: NetworkInfo, test?: unknown) {
	setTrpcClient(
		createMockTrpcClient({
			"network.info": () => info,
			...(test !== undefined ? { "network.test": () => test } : {}),
		}),
	)
}

function renderSection() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<NetworkSection />
		</QueryClientProvider>,
	)
}

const ENV_INFO: NetworkInfo = {
	source: "env",
	httpHost: null,
	httpsHost: "127.0.0.1:7897",
	bypassCount: 2,
}

beforeAll(() => {
	installClient(ENV_INFO, { ok: true, status: 200 })
})

describe("NetworkSection", () => {
	it("shows the active proxy with an emerald status dot", async () => {
		renderSection()
		await waitFor(() => {
			expect(screen.getByTestId("network-proxy-value").textContent).toContain(
				"127.0.0.1:7897",
			)
		})
		expect(
			screen.getByText("User proxy (env vars) · 127.0.0.1:7897"),
		).toBeInTheDocument()
		expect(screen.getByTestId("network-status-dot-proxy").className).toContain(
			"bg-emerald-500",
		)
		expect(screen.getByText("2 hosts bypass the proxy")).toBeInTheDocument()
	})

	it("shows the direct-connection state with a neutral dot and a setup hint", async () => {
		installClient(
			{ ...ENV_INFO, source: "none", httpsHost: null, bypassCount: 0 },
			{ ok: true, status: 200 },
		)
		renderSection()
		await waitFor(() => {
			expect(
				screen.getByText("Direct connection (no proxy)"),
			).toBeInTheDocument()
		})
		expect(screen.getByTestId("network-status-dot-proxy").className).toContain(
			"bg-muted",
		)
		expect(screen.getByText(/Enable via your system proxy/)).toBeInTheDocument()
	})

	it("shows the untested state before probing", async () => {
		installClient(ENV_INFO)
		renderSection()
		await waitFor(() => {
			expect(screen.getByText("Not tested yet")).toBeInTheDocument()
		})
		expect(screen.queryByTestId("network-test-result")).toBeNull()
	})

	it("reports a successful test with an emerald result", async () => {
		installClient(ENV_INFO, { ok: true, status: 404 })
		const user = userEvent.setup()
		renderSection()
		await user.click(await screen.findByTestId("network-test-button"))

		expect(
			await screen.findByText("GitHub is reachable (HTTP 404)"),
		).toBeInTheDocument()
		expect(
			screen.getByTestId("network-status-dot-connection").className,
		).toContain("bg-emerald-500")
	})

	it("reports a failed test with a destructive result and a hint", async () => {
		installClient(ENV_INFO, {
			ok: false,
			message: "getaddrinfo ENOENT raw.githubusercontent.com",
		})
		const user = userEvent.setup()
		renderSection()
		await user.click(await screen.findByTestId("network-test-button"))

		await screen.findByTestId("network-test-result")
		expect(screen.getByText(/GitHub is not reachable/)).toBeInTheDocument()
		expect(
			screen.getByTestId("network-status-dot-connection").className,
		).toContain("bg-destructive")
		expect(screen.getByText(/Check your proxy settings/)).toBeInTheDocument()
	})
})
