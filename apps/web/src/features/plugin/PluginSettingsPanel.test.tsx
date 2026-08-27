import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InstalledPluginsPanel } from "./PluginSettingsPanel"

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
const OTHER_ID = "66666666-6666-4666-8666-666666666666"

const PERMISSIONS = {
	sourceMeta: true,
	searchMeta: false,
	danmaku: false,
	message: false,
	imageHashes: false,
	container: false,
	download: false,
}

function installedPlugin(id: string, name: string) {
	return {
		id,
		manifest: {
			id,
			name,
			description: `${name} description`,
			version: "1.1.0",
			permissions: PERMISSIONS,
		},
		enabled: true,
		priority: 1,
		pinned: false,
		color: "",
		missing: false,
		builtin: false,
		dev: false,
		assetVersion: "1",
	}
}

function marketPlugin(id: string, name: string) {
	return {
		id,
		repo: "me/cat-viewer",
		name,
		description: `${name} description`,
		icon: undefined,
		permissions: PERMISSIONS,
		manifest: {
			id,
			name,
			description: `${name} description`,
			version: "1.2.3",
			permissions: PERMISSIONS,
		},
		state: "ok" as const,
		latest: {
			tag: "v1.2.3",
			version: "1.2.3",
			releaseUrl: "https://github.com/me/cat-viewer/releases/tag/v1.2.3",
			publishedAt: "2025-01-02T03:04:05Z",
			notes: null,
			assetName: `${id}-v1.2.3.zip`,
			assetUrl: "",
			intro: undefined,
		},
		error: undefined,
	}
}

function installClient(overrides?: {
	readonly catalog?: unknown[]
	readonly config?: { readonly registryRepo: string | null }
}) {
	mockClient.marketplace = {
		getConfig: {
			query: vi.fn(
				async () => overrides?.config ?? { registryRepo: "me/registry" },
			),
		},
		snapshot: {
			query: vi.fn(async () => ({ plugins: overrides?.catalog ?? [] })),
		},
	}
	mockClient.plugin = {
		listAll: {
			query: vi.fn(async () => [
				installedPlugin(PLUGIN_ID, "Cat Viewer"),
				installedPlugin(OTHER_ID, "Other"),
			]),
		},
		uninstall: { mutate: vi.fn(async () => undefined) },
		usageCount: { query: vi.fn(async () => 0) },
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
			<InstalledPluginsPanel />
		</QueryClientProvider>,
	)
}

const user = { click: async (el: Element) => fireEvent.click(el) }

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

describe("InstalledPluginsPanel marketplace details", () => {
	it("opens the marketplace detail dialog from the More menu for a market plugin", async () => {
		installClient({ catalog: [marketPlugin(PLUGIN_ID, "Cat Viewer")] })
		renderPanel()

		await user.click(await screen.findByTestId(`plugin-menu-${PLUGIN_ID}`))
		await user.click(
			await screen.findByTestId(`plugin-menu-detail-${PLUGIN_ID}`),
		)

		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(dialog).toBeInTheDocument()
		// Installed → the only action is Uninstall.
		expect(
			await screen.findByTestId("marketplace-detail-uninstall"),
		).toBeInTheDocument()
	})

	it("keeps the details menu entry out for plugins outside the catalog", async () => {
		installClient({ catalog: [] })
		renderPanel()

		await user.click(await screen.findByTestId(`plugin-menu-${PLUGIN_ID}`))
		await waitFor(() => {
			expect(
				screen.queryByTestId(`plugin-menu-detail-${PLUGIN_ID}`),
			).not.toBeInTheDocument()
		})
		expect(screen.queryByTestId("marketplace-detail-dialog")).toBeNull()
	})

	it("mounts the update dot on the More button when a newer release exists", async () => {
		installClient({ catalog: [marketPlugin(PLUGIN_ID, "Cat Viewer")] })
		renderPanel()

		expect(
			await screen.findByTestId(`plugin-update-dot-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			screen.queryByTestId(`plugin-update-dot-${OTHER_ID}`),
		).not.toBeInTheDocument()
	})

	it("keeps the More button dot off when the installed version is current", async () => {
		const plugin = marketPlugin(PLUGIN_ID, "Cat Viewer")
		plugin.latest = { ...plugin.latest!, version: "1.1.0", tag: "v1.1.0" }
		installClient({ catalog: [plugin] })
		renderPanel()

		await screen.findByTestId(`plugin-menu-${PLUGIN_ID}`)
		expect(
			screen.queryByTestId(`plugin-update-dot-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("keeps the More button dot off when the marketplace is disabled", async () => {
		installClient({
			catalog: [marketPlugin(PLUGIN_ID, "Cat Viewer")],
			config: { registryRepo: null },
		})
		renderPanel()

		await screen.findByTestId(`plugin-menu-${PLUGIN_ID}`)
		expect(
			screen.queryByTestId(`plugin-update-dot-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("updates a plugin from the detail dialog opened via the More menu", async () => {
		installClient({ catalog: [marketPlugin(PLUGIN_ID, "Cat Viewer")] })
		renderPanel()

		await user.click(await screen.findByTestId(`plugin-menu-${PLUGIN_ID}`))
		await user.click(
			await screen.findByTestId(`plugin-menu-detail-${PLUGIN_ID}`),
		)
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		// The detail dialog carries the primary Update action; the install
		// confirmation owns the consent, then the HTTP install posts the
		// source repo (the update source remembered across registries).
		await user.click(within(dialog).getByTestId("marketplace-detail-update"))
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
				repo: "me/cat-viewer",
				assetUrl: "",
			})
		})
	})
})
