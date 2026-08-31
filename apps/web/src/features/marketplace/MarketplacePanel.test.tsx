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
				minAppVersion: "0.1.1",
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
				sha256: "abc123def456",
				readme: { en: "# Readme heading\n\nReadme **body**." },
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
			minAppVersion: "0.1.1",
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
	readonly snapshotQuery?: (input: { force: boolean }) => Promise<unknown>
	readonly installed?: unknown[]
}) {
	mockClient.marketplace = {
		getConfig: {
			query: vi.fn(async () => overrides?.config ?? { registryRepo: null }),
		},
		setConfig: { mutate: vi.fn(async () => {}) },
		snapshot: {
			query:
				overrides?.snapshotQuery ??
				vi.fn(async () => overrides?.snapshot ?? SNAPSHOT),
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

describe("MarketplacePanel", () => {
	it("shows the setup hint until a registry repo is configured", async () => {
		installClient({ config: { registryRepo: null } })
		renderPanel()

		expect(
			await screen.findByText(/no registry repo configured/i),
		).toBeInTheDocument()
		expect(screen.queryByTestId("marketplace-catalog")).not.toBeInTheDocument()
	})

	it("shows skeleton cards while the catalog loads", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshotQuery: vi.fn(() => new Promise<never>(() => {})),
		})
		renderPanel()

		expect(
			await screen.findByTestId("marketplace-catalog-skeleton"),
		).toBeInTheDocument()
		expect(screen.queryByTestId("marketplace-catalog")).not.toBeInTheDocument()
	})

	it("shows the error with a manual refresh and never retries silently", async () => {
		const snapshotQuery = vi.fn(async () => {
			throw new Error("boom")
		})
		installClient({
			config: { registryRepo: "me/registry" },
			snapshotQuery,
		})
		renderPanel()

		expect(
			await screen.findByText(/marketplace refresh failed/i),
		).toBeInTheDocument()
		// No automatic retry: the query failed exactly once.
		expect(snapshotQuery).toHaveBeenCalledTimes(1)

		// Manual refresh first asks for confirmation (it burns GitHub API
		// quota), then forces.
		await user.click(screen.getByTestId("marketplace-refresh"))
		expect(
			await screen.findByTestId("marketplace-refresh-confirm"),
		).toBeInTheDocument()
		await user.click(screen.getByTestId("marketplace-refresh-confirm"))
		await waitFor(() => {
			expect(snapshotQuery).toHaveBeenCalledWith({ force: true })
		})
	})

	it("renders catalog entries with icon permission marks and version meta", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		expect(await screen.findByText("Cat Viewer")).toBeInTheDocument()
		// Permissions are icon marks (tooltips), not text badges, on the card.
		expect(screen.getByTitle("Source metadata")).toBeInTheDocument()
		expect(screen.getByTitle("Downloads")).toBeInTheDocument()
		// The version+date meta line sits directly under the title; the
		// card omits the repo entirely (it lives in the detail dialog).
		expect(screen.getByText(/^v1\.2\.3 · /)).toBeInTheDocument()
		expect(screen.queryByText("@me/cat-viewer")).not.toBeInTheDocument()
		// Not installed → the View button only; no ribbon, no ⋯ menu.
		expect(
			screen.getByTestId(`marketplace-view-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			screen.queryByTestId(`marketplace-menu-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
		expect(
			screen.queryByTestId(`marketplace-installed-banner-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("switches between grid and list views and never shows the repo link", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

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
		// The repo link lives only in the detail dialog — never on a row.
		expect(screen.queryByText("@me/cat-viewer")).not.toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-view-${PLUGIN_ID}`),
		).toBeInTheDocument()
	})

	it("installs from the detail dialog after confirmation and posts the asset", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		// The big dialog carries Install; the consent dialog follows.
		await user.click(await screen.findByTestId("marketplace-detail-install"))
		await screen.findByTestId("marketplace-install-confirm")
		expect(
			screen.queryByTestId("marketplace-detail-dialog"),
		).not.toBeInTheDocument()
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
				repo: "me/cat-viewer",
				assetUrl: SNAPSHOT.plugins[0]!.latest!.assetUrl,
			})
		})
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "success" }),
		)
	})

	it("installed card: straight banner + View only; dialog offers Update and Uninstall", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		// The banner strip marks the card; only the View button remains —
		// no version chip, no ⋯ menu.
		expect(
			await screen.findByTestId(`marketplace-installed-banner-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-view-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			screen.queryByTestId(`marketplace-menu-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
		expect(screen.queryByText("Installed v1.1.0")).not.toBeInTheDocument()

		await user.click(screen.getByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).queryByTestId("marketplace-detail-install"),
		).not.toBeInTheDocument()
		expect(
			within(dialog).getByTestId("marketplace-detail-update"),
		).toBeInTheDocument()
		expect(
			within(dialog).getByTestId("marketplace-detail-uninstall"),
		).toBeInTheDocument()
		expect(within(dialog).getByText("Installed v1.1.0")).toBeInTheDocument()
		expect(within(dialog).getByText("1.1.0 → 1.2.3")).toBeInTheDocument()
	})

	it("uninstalls from the detail dialog through the uninstall confirm", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		await user.click(within(dialog).getByTestId("marketplace-detail-uninstall"))
		await user.click(await screen.findByRole("button", { name: /uninstall/i }))
		await waitFor(() => {
			expect(
				(
					mockClient.plugin.uninstall as {
						mutate: ReturnType<typeof vi.fn>
					}
				).mutate,
			).toHaveBeenCalledWith({ id: PLUGIN_ID })
		})
	})

	it("updates from the detail dialog and hides the entry when up to date", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		await user.click(within(dialog).getByTestId("marketplace-detail-update"))
		expect(await screen.findByText(/1\.1\.0 → 1\.2\.3/)).toBeInTheDocument()
	})

	it("hides the update entry when the installed version is current", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.2.3")],
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).queryByTestId("marketplace-detail-update"),
		).not.toBeInTheDocument()
		expect(
			within(dialog).getByTestId("marketplace-detail-uninstall"),
		).toBeInTheDocument()
	})

	it("filters the catalog by installed state and compatible updates", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		await user.click(await screen.findByRole("button", { name: "Updates" }))
		expect(
			screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
		).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "All" }))
		await user.click(screen.getByRole("button", { name: "Installed" }))
		expect(
			screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
		).toBeInTheDocument()
	})

	it("searches the catalog by name and description", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		const input = screen.getByTestId("marketplace-search")

		// Name match keeps the card.
		fireEvent.change(input, { target: { value: "cat" } })
		await waitFor(() => {
			expect(
				screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
			).toBeInTheDocument()
		})

		// Description match keeps the card.
		fireEvent.change(input, { target: { value: "shows" } })
		await waitFor(() => {
			expect(
				screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
			).toBeInTheDocument()
		})

		// A query that matches nothing hides the card and shows the no-results hint.
		fireEvent.change(input, { target: { value: "zzz" } })
		await waitFor(() => {
			expect(
				screen.queryByTestId(`marketplace-plugin-${PLUGIN_ID}`),
			).not.toBeInTheDocument()
		})
		expect(
			screen.getByText("No plugins match your search."),
		).toBeInTheDocument()

		// Clearing the query restores the catalog.
		fireEvent.change(input, { target: { value: "" } })
		await waitFor(() => {
			expect(
				screen.getByTestId(`marketplace-plugin-${PLUGIN_ID}`),
			).toBeInTheDocument()
		})
	})

	it("keeps a quiet chip and no install action when there is no release", async () => {
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

		expect(await screen.findByText("No GitHub release yet")).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-view-${PLUGIN_ID}`),
		).toBeInTheDocument()

		await user.click(screen.getByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).getByText("No GitHub release yet"),
		).toBeInTheDocument()
		expect(
			within(dialog).queryByTestId("marketplace-detail-install"),
		).not.toBeInTheDocument()
	})

	it("gates the install and shows the requirement when the app is too old", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						manifest: {
							...SNAPSHOT.plugins[0]!.manifest,
							minAppVersion: "9.9.9",
						},
					},
				],
			},
		})
		renderPanel()

		expect(
			await screen.findByText(/Requires hoardodile ≥ v9\.9\.9/i),
		).toBeInTheDocument()

		await user.click(screen.getByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).queryByTestId("marketplace-detail-install"),
		).not.toBeInTheDocument()
		expect(
			within(dialog).getByText(/requires hoardodile ≥ v9\.9\.9/i),
		).toBeInTheDocument()
	})

	it("puts the version requirement in the card's bottom strip, not the action row", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						manifest: {
							...SNAPSHOT.plugins[0]!.manifest,
							minAppVersion: "9.9.9",
						},
					},
				],
			},
		})
		renderPanel()

		const strip = await screen.findByTestId(
			`marketplace-card-requires-${PLUGIN_ID}`,
		)
		expect(strip).toHaveTextContent("Requires hoardodile ≥ v9.9.9")
		// The action row no longer carries a requires chip of its own.
		const row = screen.getByTestId(`marketplace-view-${PLUGIN_ID}`)
		expect(within(row).queryByText(/Requires hoardodile/i)).toBeNull()
	})

	it("shows a standalone danger error line inside the card for a rate-limited entry", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						state: "error",
						latest: undefined,
						error:
							"GitHub API rate limit hit while fetching the latest release — the unauthenticated quota resets hourly; try again later",
						errorKind: "rate_limited",
					},
				],
			},
		})
		renderPanel()

		// The card owns the error as its own line (danger colour) — no
		// ticker, no chip, no raw English text anywhere.
		const cardError = await screen.findByTestId(
			`marketplace-card-error-${PLUGIN_ID}`,
		)
		expect(cardError).toHaveTextContent("Latest release info unavailable")
		expect(screen.queryByTestId("marketplace-errors-ticker")).toBeNull()
		expect(screen.queryByText(/rate limit/i)).toBeNull()

		// Dialog: one quiet line at the bottom, still no raw text.
		await user.click(screen.getByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).getByTestId("marketplace-dialog-error"),
		).toHaveTextContent("Latest release info unavailable")
		expect(within(dialog).queryByText(/rate limit/i)).toBeNull()
	})

	it("flags a rate-limited stale release on the card", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						rateLimited: true,
					},
				],
			},
		})
		renderPanel()

		// A rate-limited entry still shows data, but the card owns a
		// scrolling danger strip telling the user a newer version is known
		// yet not actioned (rate limit) — the staleness is never silent.
		const strip = await screen.findByTestId(
			`marketplace-card-error-${PLUGIN_ID}`,
		)
		expect(strip).toHaveTextContent(
			"v1.2.3 has been published, but updating is temporarily unavailable",
		)
		expect(
			screen.getByTestId(`marketplace-view-${PLUGIN_ID}`),
		).toBeInTheDocument()
	})

	it("flags a rate-limited version-only release: shows the version but no update action", async () => {
		// The free releases.atom fallback yields a version without an asset —
		// the card/dialog must surface the version + a can't-update notice
		// while refusing to offer an update (no asset to download yet).
		const versionOnlyLatest = {
			tag: "v1.3.0",
			version: "1.3.0",
			releaseUrl: "https://github.com/me/cat-viewer/releases/tag/v1.3.0",
			publishedAt: "2025-02-01T00:00:00Z",
			notes: null,
		}
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						state: "ok",
						latest: versionOnlyLatest,
						rateLimited: true,
						error: undefined,
					},
				],
			},
			installed: [installedRow("1.2.3")],
		})
		renderPanel()

		// Card: still shows a version + the update dot, plus a rate-limit strip.
		const card = await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		expect(within(card).getByText(/v1\.3\.0 · /)).toBeInTheDocument()
		expect(
			screen.getByTestId(`marketplace-update-dot-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(
			await screen.findByTestId(`marketplace-card-error-${PLUGIN_ID}`),
		).toHaveTextContent(
			"v1.3.0 has been published, but updating is temporarily unavailable",
		)

		// Detail: the version is known, but there is no update action (no asset).
		await user.click(screen.getByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).getByText(/Latest release v1\.3\.0/),
		).toBeInTheDocument()
		expect(
			within(dialog).queryByTestId("marketplace-detail-update"),
		).not.toBeInTheDocument()
		expect(
			within(dialog).getByTestId("marketplace-dialog-error"),
		).toHaveTextContent(
			"v1.3.0 has been published, but updating is temporarily unavailable",
		)
		expect(
			within(dialog).getByTestId("marketplace-detail-uninstall"),
		).toBeInTheDocument()
	})

	it("opens the detail dialog with metadata, version info, issue channels and markdown tabs", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))

		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(within(dialog).getByText("Cat Viewer")).toBeInTheDocument()
		expect(within(dialog).getByText("Shows cats")).toBeInTheDocument()
		expect(within(dialog).getByText("Source metadata")).toBeInTheDocument()
		// Version info + metadata.
		expect(within(dialog).getByText("Not installed")).toBeInTheDocument()
		expect(
			within(dialog).getByText(/Latest release v1\.2\.3/),
		).toBeInTheDocument()
		expect(within(dialog).getByText(PLUGIN_ID)).toBeInTheDocument()
		expect(within(dialog).getByText("abc123def456")).toBeInTheDocument()
		expect(within(dialog).getByText("@me/cat-viewer")).toBeInTheDocument()
		// Both issue channels.
		const issueLink = within(dialog).getByText("Report an issue").closest("a")
		expect(issueLink?.href).toContain(
			"github.com/me/cat-viewer/issues/new/choose",
		)
		const featureLink = within(dialog)
			.getByText("Request a feature")
			.closest("a")
		expect(featureLink?.href).toContain(
			"github.com/me/cat-viewer/issues/new/choose",
		)
		const securityLink = within(dialog)
			.getByText("Report a security vulnerability")
			.closest("a")
		expect(securityLink?.href).toContain(
			"github.com/me/cat-viewer/security/advisories/new",
		)
		// Readme tab is the default and renders the release readme markdown.
		expect(within(dialog).getByText("Readme heading")).toBeInTheDocument()
		// Release notes tab switches to the release body markdown.
		await user.click(
			within(dialog).getByTestId("marketplace-detail-tab-release"),
		)
		expect(within(dialog).getByText("First release")).toBeInTheDocument()
		expect(within(dialog).queryByText("Readme heading")).not.toBeInTheDocument()
	})

	it("resolves readme image references against the release download URL", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						latest: {
							...SNAPSHOT.plugins[0]!.latest!,
							readme: { en: "# Readme\n\n![shot](shot.png)" },
						},
					},
				],
			},
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		const img = within(dialog).getByAltText("shot")
		expect(img.getAttribute("src")).toBe(
			"https://github.com/me/cat-viewer/releases/download/v1.2.3/shot.png",
		)
	})

	it("shows a hint when the release ships no readme and keeps the release notes tab", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						latest: { ...SNAPSHOT.plugins[0]!.latest!, readme: undefined },
					},
				],
			},
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		// No readme → the readme tab shows its hint…
		expect(
			within(dialog).getByText("This release ships no readme"),
		).toBeInTheDocument()
		// …and the release body lives in its own tab.
		await user.click(
			within(dialog).getByTestId("marketplace-detail-tab-release"),
		)
		expect(within(dialog).getByText("First release")).toBeInTheDocument()
	})

	it("shows a hint when the release ships no notes", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						latest: { ...SNAPSHOT.plugins[0]!.latest!, notes: null },
					},
				],
			},
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		await user.click(
			within(dialog).getByTestId("marketplace-detail-tab-release"),
		)
		expect(
			within(dialog).getByText("This release has no release notes"),
		).toBeInTheDocument()
	})

	it("shows the no-release state in the release tab", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						state: "no_release" as const,
						latest: undefined,
					},
				],
			},
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		await user.click(
			within(dialog).getByTestId("marketplace-detail-tab-release"),
		)
		expect(
			within(dialog).getByText("No GitHub release yet"),
		).toBeInTheDocument()
	})

	it("mounts the update dot on the View button when a compatible update exists", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		expect(
			await screen.findByTestId(`marketplace-update-dot-${PLUGIN_ID}`),
		).toBeInTheDocument()
	})

	it("keeps the View button dot off when the installed version is current", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.2.3")],
		})
		renderPanel()

		await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		expect(
			screen.queryByTestId(`marketplace-update-dot-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("keeps the View button dot off when the update is incompatible with the host app", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						manifest: {
							...SNAPSHOT.plugins[0]!.manifest,
							minAppVersion: "99.0.0",
						},
					},
				],
			},
		})
		renderPanel()

		await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		expect(
			screen.queryByTestId(`marketplace-update-dot-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("keeps the View button dot off when the catalog entry errors", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
			snapshot: {
				...SNAPSHOT,
				plugins: [
					{
						...SNAPSHOT.plugins[0]!,
						state: "error" as const,
						latest: undefined,
						error: "fetching latest release failed",
						errorKind: "failed" as const,
					},
				],
			},
		})
		renderPanel()

		await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		expect(
			screen.queryByTestId(`marketplace-update-dot-${PLUGIN_ID}`),
		).not.toBeInTheDocument()
	})

	it("shows the update dot on the View button in the list view too", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		await user.click(await screen.findByRole("button", { name: /list view/i }))
		expect(
			await screen.findByTestId(`marketplace-update-dot-${PLUGIN_ID}`),
		).toBeInTheDocument()
	})

	it("splits the footer only with three actions: uninstall at the left edge", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.1.0")],
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		const footer = document.querySelector('[data-slot="dialog-footer"]')
		expect(footer).not.toBeNull()
		const uninstall = within(dialog).getByTestId("marketplace-detail-uninstall")
		// DESIGN.md three-button footer: the secondary function key sits at
		// the left edge (mr-auto), cancel + update stay right-aligned.
		expect(uninstall.className).toContain("mr-auto")
		const buttons = Array.from(
			footer!.querySelectorAll("button[data-testid]"),
		).map((el) => el.getAttribute("data-testid"))
		expect(buttons[0]).toBe("marketplace-detail-uninstall")
		expect(buttons).toContain("marketplace-detail-update")
		expect(within(dialog).getByText("Cancel")).toBeInTheDocument()
	})

	it("keeps the two-button footer unsplit (installed, no update)", async () => {
		installClient({
			config: { registryRepo: "me/registry" },
			installed: [installedRow("1.2.3")],
		})
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		const footer = document.querySelector('[data-slot="dialog-footer"]')
		expect(footer).not.toBeNull()
		// DESIGN.md two-button footer: cancel leads, the function key
		// (uninstall) holds the right edge — never to the left of cancel.
		const labels = Array.from(footer!.querySelectorAll("button")).map(
			(el) => el.textContent ?? "",
		)
		expect(labels).toEqual(["Cancel", "Uninstall"])
		const uninstall = within(dialog).getByTestId("marketplace-detail-uninstall")
		expect(uninstall.className).not.toContain("mr-auto")
		expect(
			within(dialog).queryByTestId("marketplace-detail-update"),
		).not.toBeInTheDocument()
	})

	it("keeps the two-button footer unsplit (not installed)", async () => {
		installClient({ config: { registryRepo: "me/registry" } })
		renderPanel()

		await user.click(await screen.findByTestId(`marketplace-view-${PLUGIN_ID}`))
		const dialog = await screen.findByTestId("marketplace-detail-dialog")
		expect(
			within(dialog).getByTestId("marketplace-detail-install"),
		).toBeInTheDocument()
		expect(
			within(dialog).queryByTestId("marketplace-detail-uninstall"),
		).not.toBeInTheDocument()
	})
})
