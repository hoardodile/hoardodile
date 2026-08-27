import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BundledPluginsSection } from "./BundledPluginsSection"
import { pluginKeys } from "./pluginApi"

vi.mock("@hoardodile/ui/components/toast", () => ({
	toast: { add: vi.fn() },
}))

const { mockClient } = vi.hoisted(() => ({
	mockClient: {} as {
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

function seedRow(
	id: string,
	name: string,
	opts: {
		readonly installed?: boolean
		readonly installedVersion?: string
		readonly removed?: boolean
		readonly restorable?: boolean
	},
) {
	return {
		id,
		manifest: {
			id,
			name,
			description: `${name} description`,
			version: "1.2.3",
			permissions: PERMISSIONS,
		},
		installed: opts.installed ?? false,
		...(opts.installedVersion !== undefined
			? { installedVersion: opts.installedVersion }
			: {}),
		removed: opts.removed ?? false,
		restorable: opts.restorable ?? false,
	}
}

function installClient(overrides?: { readonly seeds?: unknown[] }) {
	mockClient.plugin = {
		listSeeds: { query: vi.fn(async () => overrides?.seeds ?? []) },
		restoreSeed: { mutate: vi.fn(async () => undefined) },
	}
}

function renderSection() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})
	render(
		<QueryClientProvider client={queryClient}>
			<BundledPluginsSection />
		</QueryClientProvider>,
	)
	return { queryClient }
}

const user = { click: async (el: Element) => fireEvent.click(el) }

beforeEach(() => {
	vi.restoreAllMocks()
})

describe("BundledPluginsSection", () => {
	it("lists only non-installed bundled plugins with a restore action", async () => {
		installClient({
			seeds: [
				seedRow(PLUGIN_ID, "Cat Viewer", {
					removed: true,
					restorable: true,
				}),
				seedRow(OTHER_ID, "Other", {
					installed: true,
					installedVersion: "1.1.0",
				}),
			],
		})
		renderSection()

		const section = await screen.findByTestId("plugins-bundled-section")
		expect(within(section).getByText("Cat Viewer")).toBeInTheDocument()
		expect(
			within(section).getByTestId(`bundled-restore-${PLUGIN_ID}`),
		).toBeInTheDocument()
		expect(within(section).queryByText("Other")).toBeNull()
		expect(within(section).queryByText("Installed v1.1.0")).toBeNull()
	})

	it("restores a removed plugin through the offline restore mutation", async () => {
		installClient({
			seeds: [
				seedRow(PLUGIN_ID, "Cat Viewer", {
					removed: true,
					restorable: true,
				}),
			],
		})
		renderSection()

		const section = await screen.findByTestId("plugins-bundled-section")
		await user.click(
			within(section).getByTestId(`bundled-restore-${PLUGIN_ID}`),
		)
		await waitFor(() => {
			expect(
				(
					mockClient.plugin.restoreSeed as {
						mutate: ReturnType<typeof vi.fn>
					}
				).mutate,
			).toHaveBeenCalledWith({ id: PLUGIN_ID })
		})
	})

	it("hides the section once every bundled plugin is installed", async () => {
		installClient({
			seeds: [
				seedRow(PLUGIN_ID, "Cat Viewer", {
					installed: true,
					installedVersion: "1.2.3",
				}),
			],
		})
		const { queryClient } = renderSection()

		await waitFor(() => {
			expect(queryClient.getQueryData(pluginKeys.seeds())).toBeDefined()
		})
		expect(screen.queryByTestId("plugins-bundled-section")).toBeNull()
	})

	it("hides the section when the host ships no bundled plugins", async () => {
		installClient()
		const { queryClient } = renderSection()

		await waitFor(() => {
			expect(queryClient.getQueryData(pluginKeys.seeds())).toBeDefined()
		})
		expect(screen.queryByTestId("plugins-bundled-section")).toBeNull()
	})
})
