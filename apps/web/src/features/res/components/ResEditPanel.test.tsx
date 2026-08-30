import type { Resource } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResEditPanel } from "./ResEditPanel"

vi.mock("@/trpc/client", () => ({
	getTrpcClient: () => mockClient,
}))

const { mockClient } = vi.hoisted(() => ({
	mockClient: {} as {
		plugin: { readonly [k in string]: unknown }
		resource: { readonly [k in string]: unknown }
	},
}))

// A UUID the server has never seen — a residual id left behind by an
// uninstalled plugin.
const UNKNOWN_PLUGIN_ID = "99999999-9999-4999-8999-999999999999"

function installClient() {
	mockClient.plugin = {
		listAll: { query: vi.fn(async () => []) },
	}
	mockClient.resource = {
		sourceNames: { query: vi.fn(async () => []) },
		update: { mutate: vi.fn(async () => undefined) },
		setContentPluginId: { mutate: vi.fn(async () => ({ ok: true })) },
	}
}

const resource: Resource = {
	id: "res-1",
	name: "X",
	intro: "",
	tagIds: [],
	charIds: [],
	contentPluginId: UNKNOWN_PLUGIN_ID,
	coverVersion: 1,
	createdAt: 100,
	updatedAt: 100,
	dislikeCount: 0,
	dislikedRecently: false,
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
			<ResEditPanel resource={resource} />
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	vi.restoreAllMocks()
	installClient()
})

describe("ResEditPanel residual plugin id", () => {
	it("renders a compact missing label instead of the raw uuid", () => {
		renderPanel()
		const trigger = screen.getByTestId("edit-content-type")
		// The trigger shows the truncated id, never the full UUID.
		expect(trigger.textContent).toContain("99999999…")
		expect(trigger.textContent).not.toContain(UNKNOWN_PLUGIN_ID)
		// The full id stays discoverable via tooltip.
		const label = screen.getByTitle(UNKNOWN_PLUGIN_ID)
		expect(label.textContent).toContain("99999999…")
		expect(label.textContent).not.toContain(UNKNOWN_PLUGIN_ID)
	})
})
