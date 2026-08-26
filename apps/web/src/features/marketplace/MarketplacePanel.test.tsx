import { toast } from "@hoardodile/ui/components/toast"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MarketplacePanel } from "./MarketplacePanel"

vi.mock("@hoardodile/ui/components/toast", () => ({
	toast: { add: vi.fn() },
}))

const { mockClient } = vi.hoisted(() => ({
	mockClient: {} as {
		marketplace: { readonly [k in string]: unknown }
		plugin: { readonly [k in string]: unknown }
	},
}))

vi.mock("@/trpc/client", () => ({
	getTrpcClient: () => mockClient,
}))

const PLUGIN_ID = "55555555-5555-4555-8555-555555555555"

const SNAPSHOT = {
	registryRepo: "me/registry",
	fetchedAt: 1_700_000_000_000,
	plugins: [
		{
			id: PLUGIN_ID,
			repo: "me/cat-viewer",
			name: "Cat Viewer",
			description: "Shows cats",
			icon: undefined,
			permissions: {
				sourceMeta: true,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
				container: false,
				download: true,
			},
			state: "ok",
			latest: {
				tag: "v1.2.3",
				version: "1.2.3",
				releaseUrl: "https://github.com/me/cat-viewer/releases/tag/v1.2.3",
				publishedAt: "2025-01-02T03:04:05Z",
				notes: "First release",
				assetName: `${PLUGIN_ID}-v1.2.3.zip`,
				assetUrl: `https://github.com/me/cat-viewer/releases/download/v1.2.3/${PLUGIN_ID}-v1.2.3.zip`,
				sha256: undefined,
			},
			error: undefined,
		},
	],
	errors: [],
}

function installedRow(version: string) {
	return {
		id: PLUGIN_ID,
		manifest: {
			id: PLUGIN_ID,
			name: "Cat Viewer",
			description: "Shows cats",
			version,
			permissions: SNAPSHOT.plugins[0]!.permissions,
		},
		enabled: true,
		priority: 100,
		pinned: true,
		color: "",
		missing: false,
		builtin: false,
		dev: false,
		assetVersion: "1",
	}
}

function installClient(overrides?: {
	readonly config?: { readonly registryRepo: string | null }
	readonly snapshot?: unknown
	readonly installed?: unknown[]
}) {
	mockClient.marketplace = {
		getConfig: {
			query: vi.fn(async () => overrides?.config ?? { registryRepo: null }),
		},
		setConfig: { mutate: vi.fn(async () => {}) },
		snapshot: {
			query: vi.fn(async () => overrides?.snapshot ?? SNAPSHOT),
		},
	}
	mockClient.plugin = {
		listAll: { query: vi.fn(async () => overrides?.installed ?? []) },
	}
}

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	render(
		<QueryClientProvider client={queryClient}>
			<MarketplacePanel />
		</QueryClientProvider>,
	)
	return { queryClient }
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Promise.resolve(
				new Response(JSON.stringify({ pluginId: PLUGIN_ID }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		),
	)
})

describe("MarketplacePanel", () => {
	it("shows the setup hint until a registry repo is configured", async () => {
		installClient({ config: { registryRepo: null } })
		renderPanel()

		expect(
			await screen.findByText(/no registry repo configured/i),
		).toBeInTheDocument()
		expect(screen.queryByTestId("marketplace-catalog")).not.toBeInTheDocument()
	})

	it("renders catalog entries with their latest version and permissions", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		expect(await screen.findByText("Cat Viewer")).toBeInTheDocument()
		expect(screen.getByText("Source metadata")).toBeInTheDocument()
		expect(screen.getByText("Downloads")).toBeInTheDocument()
		expect(screen.getByText(/^v1\.2\.3/)).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-install-${PLUGIN_ID}`),
		).toBeInTheDocument()
	})

	it("offers an update when the installed version is older", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		expect(
			await screen.findByTestId(`marketplace-update-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(screen.getByText(/update to v1\.2\.3/i)).toBeInTheDocument()
	})

	it("shows the installed chip when up to date", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.2.3")],
		})
		renderPanel()

		expect(await screen.findByText("Installed v1.2.3")).toBeInTheDocument()
		expect(
			screen.queryByTestId(`marketplace-update-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("confirms before installing and posts the release asset to the server", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()
		const user = { click: async (el: Element) => fireEvent.click(el) }

		await user.click(
			await screen.findByTestId(`marketplace-install-${PLUGIN_ID}`),
		)
		await screen.findByTestId("marketplace-install-confirm")
		await user.click(screen.getByTestId("marketplace-install-confirm"))

		await waitFor(() => {
			const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
			const installCall = calls.find(([input]) =>
				String(input).includes("/api/plugin-marketplace/install"),
			)
			expect(installCall).toBeDefined()
			expect(JSON.parse(String(installCall?.[1]?.body))).toMatchObject({
				id: PLUGIN_ID,
				assetUrl: SNAPSHOT.plugins[0]!.latest!.assetUrl,
			})
		})
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "success" }),
		)
	})
})
