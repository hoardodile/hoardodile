import { screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderRouter } from "@/test/render-router"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"

const PLUGIN_ID = "55555555-5555-4555-8555-555555555555"

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

/** A catalog with one plugin and an installed row whose version is older
    (updates = true) or current/absent (updates = false). */
function installHandlers(updates: boolean) {
	const installed = updates
		? [
				{
					id: PLUGIN_ID,
					manifest: {
						id: PLUGIN_ID,
						name: "Cat Viewer",
						description: "Shows cats",
						version: "1.1.0",
						permissions: { sourceMeta: true, searchMeta: false },
					},
					enabled: true,
					priority: 1,
					pinned: false,
					color: "",
					missing: false,
					builtin: false,
					dev: false,
					assetVersion: "1",
				},
			]
		: []
	const plugins = updates
		? [
				{
					id: PLUGIN_ID,
					repo: "me/cat-viewer",
					name: "Cat Viewer",
					description: "Shows cats",
					icon: undefined,
					permissions: { sourceMeta: true, searchMeta: false },
					manifest: {
						id: PLUGIN_ID,
						name: "Cat Viewer",
						description: "Shows cats",
						version: "1.2.3",
						permissions: { sourceMeta: true, searchMeta: false },
					},
					state: "ok",
					latest: {
						tag: "v1.2.3",
						version: "1.2.3",
						releaseUrl: "https://github.com/me/cat-viewer/releases/tag/v1.2.3",
						publishedAt: "2025-01-02T03:04:05Z",
						notes: null,
						assetName: `${PLUGIN_ID}-v1.2.3.zip`,
						assetUrl: "",
						intro: undefined,
					},
					error: undefined,
				},
			]
		: []
	return {
		"auth.status": () => ({ authenticated: true, configured: true }),
		"sync.summary": () => ({ remindDays: 7, devices: [] }),
		"marketplace.getConfig": () => ({ registryRepo: "me/registry" }),
		"marketplace.snapshot": () => ({
			registryRepo: "me/registry",
			fetchedAt: 1,
			plugins,
			errors: [],
		}),
		"plugin.listAll": () => installed,
	}
}

beforeEach(() => {
	vi.restoreAllMocks()
	// The route guard's `auth.status` HTTP probe (plain fetch, not tRPC)
	// answers authenticated so the settings layout actually mounts.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Promise.resolve(
				new Response(
					JSON.stringify({ authenticated: true, configured: true }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			),
		),
	)
})

describe("settings tab update dots", () => {
	it("dots the marketplace and plugins tabs when a compatible update exists", async () => {
		setTrpcClient(createMockTrpcClient(installHandlers(true)))
		renderRouter({ initialEntries: ["/settings/marketplace"] })

		// Wait for the catalog (the shared snapshot query the tab dots
		// derive from) to resolve, then both tab bars — mobile strip +
		// desktop nav — dot the marketplace and the plugins tabs.
		await screen.findByTestId(`marketplace-plugin-${PLUGIN_ID}`)
		expect(await screen.findAllByTestId("me-tab-update-dot")).toHaveLength(4)
	})

	it("keeps the tabs undotted when no update is available", async () => {
		setTrpcClient(createMockTrpcClient(installHandlers(false)))
		renderRouter({ initialEntries: ["/settings/marketplace"] })

		// Both tab bars render the tab (mobile strip + desktop nav).
		expect(await screen.findAllByTestId("me-tab-marketplace")).toHaveLength(2)
		// The empty hint renders only once the catalog query resolved —
		// afterwards the tabs must carry no dot.
		await screen.findByText(/registry lists no plugins yet/i)
		expect(screen.queryAllByTestId("me-tab-update-dot")).toHaveLength(0)
	})
})
