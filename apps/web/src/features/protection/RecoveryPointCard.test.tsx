import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import type { RecoveryPoint } from "./api"
import { RecoveryPointCard } from "./RecoveryPointCard"

beforeAll(async () => {
	await i18n.changeLanguage("en")
})

const pointId = "3c7d894c-6e45-4f7c-b6b4-927dcc7a0ef2"

function point(overrides: Partial<RecoveryPoint> = {}): RecoveryPoint {
	return {
		id: pointId,
		snapshotId: "a".repeat(64),
		createdAt: 1_700_000_000_000,
		name: "Laptop backup",
		note: "",
		kind: "manual",
		pinned: true,
		totalBytes: 2_097_152,
		manifest: {
			formatVersion: 1,
			recoveryPointId: pointId,
			libraryId: pointId,
			instanceId: pointId,
			createdAt: 1_700_000_000_000,
			appVersion: "1.0.0",
			latestVersion: 1,
			databasePath: "1/checkpoint/app.sqlite",
			databaseSha256: "b".repeat(64),
			databaseSchema: "schema",
			pluginCount: 0,
			manifestSha256: "c".repeat(64),
		},
		...overrides,
	}
}

function clientFor(
	handlers: Record<string, (input: unknown) => unknown>,
): TRPCClient {
	return new Proxy(
		{},
		{
			get: (_target, namespace: string) =>
				new Proxy(
					{},
					{
						get: (_value, procedure: string) => ({
							query: async (input: unknown) =>
								handlers[`${namespace}.${procedure}`]?.(input),
							mutate: async (input: unknown) =>
								handlers[`${namespace}.${procedure}`]?.(input),
						}),
					},
				),
		},
	) as unknown as TRPCClient
}

function mount(
	card: ReactElement,
	handlers: Record<string, (input: unknown) => unknown> = {},
) {
	setTrpcClient(
		clientFor({
			"protection.status": () => ({
				repositories: [{ id: "local", name: "Local backups" }],
				enabled: true,
				backupRoot: "Configured backup folder",
				drillTargets: [{ id: "local", path: "Default scratch folder" }],
				policy: { automatic: 3 },
				autoBackupIntervalHours: 24,
				storage: { frozen: false },
				maintenance: null,
				maintenanceError: null,
				maintenanceActive: false,
			}),
			...handlers,
		}),
	)
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>{card}</QueryClientProvider>,
	)
}

function card(
	options: {
		readonly point?: Partial<RecoveryPoint>
		readonly restoreOnly?: boolean
		readonly canDelete?: boolean
	} = {},
) {
	return (
		<RecoveryPointCard
			point={point(options.point)}
			repositoryId="local"
			source="This device's backups"
			canDelete={options.canDelete ?? true}
			restoreOnly={options.restoreOnly ?? false}
		/>
	)
}

it("renders the recovery point as a card with its chips, restore action and tools", () => {
	mount(card())
	expect(screen.getByText("Laptop backup")).toBeInTheDocument()
	expect(screen.getByText("Manual")).toBeInTheDocument()
	expect(screen.getByText("Keep indefinitely")).toBeInTheDocument()
	expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument()
	expect(
		screen.getByRole("button", { name: "Advanced backup actions" }),
	).toBeInTheDocument()
})

it("hides the card tools in restore-only mode", () => {
	mount(card({ restoreOnly: true }))
	expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument()
	expect(
		screen.queryByRole("button", { name: "Advanced backup actions" }),
	).not.toBeInTheDocument()
})

it("edits the point details from the card menu", async () => {
	const metadata = vi.fn(async () => ({}))
	mount(card(), { "protection.metadata": metadata })
	const user = userEvent.setup()
	await user.click(
		screen.getByRole("button", { name: "Advanced backup actions" }),
	)
	await user.click(
		await screen.findByRole("menuitem", { name: "Edit details" }),
	)
	const name = await screen.findByLabelText("Name")
	await user.clear(name)
	await user.type(name, "Renamed backup")
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }),
	)
	expect(metadata).toHaveBeenCalledWith({
		repositoryId: "local",
		pointId,
		metadata: {
			name: "Renamed backup",
			note: "",
			kind: "manual",
			pinned: true,
		},
	})
})

it("expands the file comparison from the card menu", async () => {
	const compare = vi.fn(async () => ({ id: "compare-job" }))
	mount(card(), {
		"protection.compare": compare,
		"protection.job": () => ({
			id: "compare-job",
			kind: "compare",
			state: "succeeded",
			createdAt: 1_700_000_000_000,
			result: [],
		}),
	})
	const user = userEvent.setup()
	await user.click(
		screen.getByRole("button", { name: "Advanced backup actions" }),
	)
	await user.click(
		await screen.findByRole("menuitem", { name: "Compare files" }),
	)
	expect(compare).toHaveBeenCalledWith({ repositoryId: "local", pointId })
	expect(await screen.findByText("No file differences found.")).toBeVisible()
})

it("keeps the delete action inert while it is the last recovery point", async () => {
	const remove = vi.fn(async () => ({}))
	mount(card({ canDelete: false }), { "protection.deletePoint": remove })
	const user = userEvent.setup()
	await user.click(
		screen.getByRole("button", { name: "Advanced backup actions" }),
	)
	await user.click(await screen.findByRole("menuitem", { name: "Remove" }))
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	expect(remove).not.toHaveBeenCalled()
})

it("confirms removal once another recovery point remains", async () => {
	const remove = vi.fn(async () => ({}))
	mount(card(), { "protection.deletePoint": remove })
	const user = userEvent.setup()
	await user.click(
		screen.getByRole("button", { name: "Advanced backup actions" }),
	)
	await user.click(await screen.findByRole("menuitem", { name: "Remove" }))
	await user.click(
		within(await screen.findByRole("dialog")).getByRole("button", {
			name: "Remove",
		}),
	)
	expect(remove).toHaveBeenCalledWith({ repositoryId: "local", pointId })
})
