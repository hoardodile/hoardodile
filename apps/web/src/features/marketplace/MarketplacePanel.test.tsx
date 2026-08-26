import { toast } from "@hoardodile/ui/components/toast"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
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
			manifest: {
				id: PLUGIN_ID,
				name: "Cat Viewer",
				description: "Shows cats",
				version: "1.2.3",
				permissions: {
					sourceMeta: true,
					searchMeta: false,
					danmaku: false,
					message: false,
					imageHashes: false,
					container: false,
					download: true,
				},
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

	it("renders catalog entries with icon permission marks and version meta", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		expect(await screen.findByText("Cat Viewer")).toBeInTheDocument()
		// Permissions are icon marks (tooltips), not text badges, on the card.
		expect(screen.getByTitle("Source metadata")).toBeInTheDocument()
		expect(screen.getByTitle("Downloads")).toBeInTheDocument()
		// The version+date meta line sits directly under the title; the
		// card omits the repo entirely (it lives in the details dialog
		// and the list row).
		expect(screen.getByText(/^v1\.2\.3 · /)).toBeInTheDocument()
		expect(screen.queryByText("@me/cat-viewer")).not.toBeInTheDocument()
		// Not installed → the toggle is off; the details button sits
		// bottom-right instead of an install button.
		expect(
			screen.getByTestId(`marketplace-toggler-${PLUGIN_ID}`),
		).toHaveAttribute("aria-checked", "false")
		expect(
			screen.getByTestId(`marketplace-details-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(screen.queryByTestId(`marketplace-install-${PLUGIN_ID}`)).toBeNull()
		// The registry line shows the full URL, not the bare owner/repo.
		expect(
			screen.getByText("Current registry: https://github.com/me/registry"),
		).toBeInTheDocument()
	})

	it("switches between grid and list views", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()
		const user = { click: async (el: Element) => fireEvent.click(el) }

		await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		expect(screen.getByTestId("marketplace-catalog")).toHaveAttribute(
			"data-view",
			"grid",
		)

		await user.click(screen.getByRole("button", { name: /list view/i }))
		await waitFor(() => {
			expect(screen.getByTestId("marketplace-catalog")).toHaveAttribute(
				"data-view",
				"list",
			)
		})
		// The list row keeps the repo link (the compact card drops it).
		expect(screen.getByText("@me/cat-viewer")).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-toggler-${PLUGIN_ID}`),
		).toHaveAttribute("aria-checked", "false")
	})

	it("installs via the toggle after confirmation and posts the asset", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()
		const user = { click: async (el: Element) => fireEvent.click(el) }

		await user.click(
			await screen.findByTestId(`marketplace-toggler-${PLUGIN_ID}`),
		)
		await screen.findByTestId("marketplace-install-confirm")
		// The install confirm is a decision dialog: no release notes here
		// (those belong to the details dialog).
		expect(screen.queryByText("First release")).toBeNull()
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

	it("offers an update via the footer button when the installed version is older", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		expect(
			await screen.findByTestId(`marketplace-update-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(screen.getByText(/update to v1\.2\.3/i)).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-toggler-${PLUGIN_ID}`),
		).toHaveAttribute("aria-checked", "true")

		// The update confirm shows the version arrow instead of notes.
		const user = { click: async (el: Element) => fireEvent.click(el) }
		await user.click(screen.getByTestId(`marketplace-update-${PLUGIN_ID}`))
		expect(await screen.findByText(/1\.1\.0 → 1\.2\.3/)).toBeInTheDocument()
	})

	it("keeps the toggle on when up to date and shows no update button", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.2.3")],
		})
		renderPanel()

		await waitFor(() => {
			expect(
				screen.getByTestId(`marketplace-toggler-${PLUGIN_ID}`),
			).toHaveAttribute("aria-checked", "true")
		})
		expect(
			screen.queryByTestId(`marketplace-update-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
		expect(screen.queryByText("Installed v1.2.3")).toBeNull()
	})

	it("uninstalls through the toggle when the plugin is installed", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.2.3")],
		})
		renderPanel()
		const user = { click: async (el: Element) => fireEvent.click(el) }

		await user.click(
			await screen.findByTestId(`marketplace-toggler-${PLUGIN_ID}`),
		)
		expect(
			await screen.findByRole("button", { name: /uninstall/i }),
		).toBeInTheDocument()
		await user.click(screen.getAllByRole("button", { name: /uninstall/i })[0]!)

		await waitFor(() => {
			const uninstall = (
				mockClient.plugin.uninstall as {
					mutate: ReturnType<typeof vi.fn>
				}
			).mutate
			expect(uninstall).toHaveBeenCalledWith({
				id: PLUGIN_ID,
			})
		})
	})

	it("shows a disabled toggle and a quiet chip when there is no release", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						state: "no_release",
						latest: undefined,
					},
				],
			},
		})
		renderPanel()

		await waitFor(() => {
			expect(
				screen.getByTestId(`marketplace-toggler-${PLUGIN_ID}`),
			).toHaveAttribute("data-disabled")
		})
		expect(screen.getByText("No GitHub release yet")).toBeInTheDocument()
	})

	it("opens the details dialog with description, permissions, notes and links", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()
		const user = { click: async (el: Element) => fireEvent.click(el) }

		await user.click(
			await screen.findByTestId(`marketplace-details-${PLUGIN_ID}`),
		)

		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(dialog).toBeInTheDocument()
		// Notes live in the details dialog — never on the card.
		expect(within(dialog).getByText("First release")).toBeInTheDocument()
		expect(within(dialog).getByText("Cat Viewer")).toBeInTheDocument()
		expect(within(dialog).getByText("Shows cats")).toBeInTheDocument()
		expect(within(dialog).getByText("Source metadata")).toBeInTheDocument()
		expect(
			(dialog.querySelector("a") as HTMLAnchorElement | null)?.href,
		).toContain("github.com/me/cat-viewer")
	})
})
