import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import type { RecoveryPoint } from "./api"
import { RecoveryPanel } from "./RecoveryPanel"

beforeAll(async () => {
	await i18n.changeLanguage("en")
})

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

it("keeps the selected recovery point bound while the list refreshes and requires the exact confirmation", async () => {
	const id = "3c7d894c-6e45-4f7c-b6b4-927dcc7a0ef2"
	const point: RecoveryPoint = {
		id,
		snapshotId: "a".repeat(64),
		createdAt: 1_700_000_000_000,
		name: "Selected backup",
		note: "",
		kind: "manual",
		pinned: true,
		manifest: {
			formatVersion: 1,
			recoveryPointId: id,
			libraryId: id,
			instanceId: id,
			createdAt: 1_700_000_000_000,
			appVersion: "1.0.0",
			latestVersion: 1,
			databasePath: "1/checkpoint/app.sqlite",
			databaseSha256: "b".repeat(64),
			databaseSchema: "schema",
			pluginCount: 0,
			manifestSha256: "c".repeat(64),
		},
	}
	let points = [point]
	const restore = vi.fn(async () => ({ id: "restore-job", state: "queued" }))
	const drill = vi.fn(async () => ({ id: "drill-job", state: "queued" }))
	const planId = "779fd51d-0c04-454a-abd0-d625da083ea2"
	setTrpcClient(
		clientFor({
			"protection.status": () => ({
				repositories: [{ id: "local", name: "Local backups" }],
				enabled: true,
				backupRoot: "Configured backup folder",
				drillTargets: [
					{ id: "local", path: "Default scratch folder" },
					{ id: "external", path: "Alternate disk" },
				],
				policy: { withinHours: 24, daily: 7, weekly: 4, monthly: 12 },
				storage: { frozen: false },
				maintenance: null,
				maintenanceError: null,
				maintenanceActive: false,
			}),
			"protection.points": () => points,
			"protection.jobs": () => [],
			"protection.prepareRestore": () => ({ id: planId, point }),
			"protection.restore": restore,
			"protection.drill": drill,
		}),
	)
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	render(
		<QueryClientProvider client={queryClient}>
			<RecoveryPanel />
		</QueryClientProvider>,
	)
	const user = userEvent.setup()
	const row = await screen.findByTestId(`recovery-point-${id}`)
	expect(restore).not.toHaveBeenCalled()
	await user.click(within(row).getByText("Selected backup"))
	await user.click(within(row).getByText("More backup actions"))
	await user.click(within(row).getByRole("button", { name: "Recovery drill" }))
	await user.click(
		screen.getByRole("checkbox", {
			name: "Restore and verify a full temporary copy",
		}),
	)
	await user.click(
		screen.getByRole("button", { name: "Temporary recovery folder" }),
	)
	await user.click(await screen.findByText("Alternate disk"))
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Recovery drill",
		}),
	)
	await waitFor(() =>
		expect(drill).toHaveBeenCalledWith({
			repositoryId: "local",
			pointId: id,
			full: true,
			targetId: "external",
		}),
	)
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	)
	await user.click(within(row).getByRole("button", { name: "Restore" }))
	const confirmation = await screen.findByTestId("full-restore-confirm")
	const submit = screen.getByTestId("full-restore-submit")
	expect(submit).toBeDisabled()
	await user.type(confirmation, "restore")
	expect(submit).toBeDisabled()
	points = [
		{
			...point,
			id: "f06d176c-60e7-4bdb-9200-858eb1b031af",
			name: "Newer incoming backup",
			createdAt: point.createdAt + 60_000,
		},
		point,
	]
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: ["protection", "points"] })
	})
	expect(
		within(screen.getByRole("dialog")).getByText(/Selected backup/),
	).toBeInTheDocument()
	expect(restore).not.toHaveBeenCalled()
	await user.clear(confirmation)
	await user.type(confirmation, "RESTORE")
	expect(submit).toBeEnabled()
	await user.click(submit)
	await waitFor(() =>
		expect(restore).toHaveBeenCalledWith({ planId, confirmation: "RESTORE" }),
	)
	queryClient.clear()
})
