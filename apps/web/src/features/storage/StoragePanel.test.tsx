import type { StorageOverview } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { StoragePanel } from "./StoragePanel"

const { overviewRef, baseOverview } = vi.hoisted(() => {
	const baseOverview: StorageOverview = {
		volume: { totalBytes: 1_000_000, freeBytes: 400_000 },
		usedBytes: 600_000,
		databaseBytes: 100_000,
		cacheBytes: 50_000,
		trashBytes: 30_000,
		archivedBytes: 25_000,
		backupBytes: 20_000,
		otherBytes: 10_000,
		lowSpace: false,
		resources: {
			totalBytes: 390_000,
			byPlugin: [
				{
					pluginId: "plugin-a",
					name: "Plugin A",
					sizeBytes: 350_000,
					resourceCount: 12,
				},
				{ pluginId: "plugin-b", sizeBytes: 40_000, resourceCount: 3 },
			],
			unattributedBytes: 0,
			unattributedCount: 0,
		},
	}
	return {
		overviewRef: { value: baseOverview },
		baseOverview,
	}
})

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) => {
			if (params === undefined) return key
			return `${key}(${JSON.stringify(params)})`
		},
	}),
}))

vi.mock("./api", () => ({
	storageOverviewQueryOptions: () => ({
		queryKey: ["storage", "overview"],
		queryFn: async () => overviewRef.value,
	}),
}))

vi.mock("@/features/res/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/features/res/api")>()
	return {
		...actual,
		resListCardsQueryOptions: () => ({
			queryKey: ["res", "list-cards", "count"],
			queryFn: async () => ({ rows: [], total: 42 }),
		}),
	}
})

vi.mock("@/features/settings/use-precache", () => ({
	usePrecache: () => ({
		state: {
			status: "idle",
			progress: { phase: null, current: 0, total: 0 },
			warming: { done: 0, total: 0 },
			result: null,
			error: null,
			conflict: false,
		},
		start: vi.fn(),
		abort: vi.fn(),
		resumeIfRunning: vi.fn(),
	}),
}))

function renderPanel() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={client}>
			<StoragePanel />
		</QueryClientProvider>,
	)
}

describe("StoragePanel", () => {
	beforeEach(() => {
		overviewRef.value = baseOverview
	})

	test("renders the status strip, legend rows and total line", async () => {
		renderPanel()

		// Status strip: used / total, free count.
		expect(await screen.findByTestId("storage-database")).toBeInTheDocument()
		expect(screen.getAllByText(/977 KB/).length).toBeGreaterThan(0)
		expect(screen.getByText(/391 KB/)).toBeInTheDocument()
		expect(await screen.findByText(/itemCount/)).toBeInTheDocument()

		// Every legend row is present under its group.
		expect(
			await screen.findByTestId("storage-plugin:plugin-a"),
		).toBeInTheDocument()
		expect(screen.getByTestId("storage-cache")).toBeInTheDocument()
		expect(screen.getByTestId("storage-trash")).toBeInTheDocument()
		expect(screen.getByTestId("storage-backups")).toBeInTheDocument()
		expect(screen.getByTestId("storage-other")).toBeInTheDocument()

		// Total line.
		expect(screen.getByText("storage.usedByHoardodile")).toBeInTheDocument()
	})

	test("renders per-plugin rows with names and counts", async () => {
		renderPanel()

		expect(
			await screen.findByTestId("storage-plugin:plugin-a"),
		).toBeInTheDocument()
		expect(screen.getByText("Plugin A")).toBeInTheDocument()
		// Unknown plugin ids fall back to the raw id.
		expect(screen.getByText("plugin-b")).toBeInTheDocument()
		expect(
			screen.getByText('storage.pluginCount({"count":12})'),
		).toBeInTheDocument()
		expect(
			screen.getByText('storage.pluginCount({"count":3})'),
		).toBeInTheDocument()
	})

	test("renders the unattributed-resources row with a precache reminder", async () => {
		overviewRef.value = {
			...baseOverview,
			resources: {
				...baseOverview.resources,
				unattributedBytes: 64_000_000_000,
				unattributedCount: 1216,
			},
		}
		renderPanel()

		expect(
			await screen.findByTestId("storage-unattributed"),
		).toBeInTheDocument()
		expect(
			screen.getByText('storage.unattributedCount({"count":1216})'),
		).toBeInTheDocument()
	})

	test("hides the unattributed-resources row when nothing is unmeasured", async () => {
		renderPanel()

		expect(await screen.findByTestId("storage-database")).toBeInTheDocument()
		expect(screen.queryByTestId("storage-unattributed")).not.toBeInTheDocument()
	})

	test("renders without volume info", async () => {
		overviewRef.value = { ...baseOverview, volume: null }
		renderPanel()

		expect(await screen.findByTestId("storage-database")).toBeInTheDocument()
		expect(screen.getByText("storage.volumeUnavailable")).toBeInTheDocument()
	})

	test("renders the archived copies row and the other-categories hint", async () => {
		renderPanel()

		expect(await screen.findByTestId("storage-archived")).toBeInTheDocument()
		expect(screen.getByTestId("storage-other")).toBeInTheDocument()
	})

	test("shows the low-space banner when the volume is low", async () => {
		overviewRef.value = { ...baseOverview, lowSpace: true }
		renderPanel()

		expect(await screen.findByTestId("storage-low-space")).toBeInTheDocument()
		expect(screen.getByText("storage.lowSpaceBanner")).toBeInTheDocument()
	})

	test("clearing the cache opens a confirmation dialog", async () => {
		const user = userEvent.setup()
		renderPanel()

		const clearButton = await screen.findByTestId("storage-clear-cache")
		await user.click(clearButton)
		expect(screen.getByText("storage.clearCacheTitle")).toBeInTheDocument()
		expect(screen.getByTestId("storage-clear-confirm")).toBeInTheDocument()
	})

	test("renders the cache group's precache control", async () => {
		renderPanel()

		expect(await screen.findByTestId("precache-thumbnails")).toBeInTheDocument()
	})
})
