import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, expect, it } from "vitest"
import { authStatusQueryKey } from "@/features/auth"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { MaintenanceScreen } from "./MaintenanceScreen"

beforeAll(async () => {
	await i18n.changeLanguage("en")
})

const pointId = "3c7d894c-6e45-4f7c-b6b4-927dcc7a0ef2"

const status = {
	instanceId: "97ca94be-5c84-411e-b67d-d80e20f0077b",
	repositories: [{ id: "local", name: "Local backups" }],
	enabled: true,
	lastBackupAt: 1_700_000_000_000,
	lastAutoBackupAt: 1_700_000_000_000,
	backupRoot: "Configured backup folder",
	policy: { automatic: 3 },
	autoBackupIntervalHours: 24,
	drillTargets: [],
	storage: { frozen: false },
	maintenance: null,
	maintenanceError: null,
	maintenanceActive: false,
}

function mount() {
	const handlers: Record<string, () => unknown> = {
		"protection.status": () => status,
		"protection.jobs": () => [],
		"protection.points": () => [
			{
				id: pointId,
				snapshotId: "a".repeat(64),
				createdAt: 1_700_000_000_000,
				name: "Laptop backup",
				note: "",
				kind: "manual",
				pinned: true,
				manifest: { libraryId: pointId },
			},
		],
		"replication.status": () => ({
			role: "receive",
			name: "Laptop",
			paused: false,
			source: null,
			peers: [],
		}),
		"sync.summary": () => ({ remindDays: 7 }),
	}
	setTrpcClient(
		new Proxy(
			{},
			{
				get: (_target, namespace: string) =>
					new Proxy(
						{},
						{
							get: (_value, procedure: string) => ({
								query: async () => handlers[`${namespace}.${procedure}`]?.(),
								mutate: async () => ({}),
							}),
						},
					),
			},
		) as unknown as TRPCClient,
	)
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	queryClient.setQueryData(authStatusQueryKey, {
		authenticated: true,
		configured: true,
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<MaintenanceScreen />
		</QueryClientProvider>,
	)
}

it("reveals the restore list behind the maintenance button instead of a disclosure triangle", async () => {
	mount()
	const toggle = await screen.findByTestId("choose-another-backup")
	expect(screen.getByTestId("library-maintenance")).toBeInTheDocument()
	expect(toggle).toHaveAttribute("aria-expanded", "false")
	expect(
		screen.queryByTestId("available-backups-section"),
	).not.toBeInTheDocument()
	const user = userEvent.setup()
	await user.click(toggle)
	expect(toggle).toHaveAttribute("aria-expanded", "true")
	expect(
		await screen.findByTestId("available-backups-section"),
	).toBeInTheDocument()
	// Restore-only: the card offers the restore action without the tools menu.
	expect(await screen.findByText("Laptop backup")).toBeInTheDocument()
	expect(
		screen.queryByRole("button", { name: "Advanced backup actions" }),
	).not.toBeInTheDocument()
	await user.click(toggle)
	expect(toggle).toHaveAttribute("aria-expanded", "false")
	expect(
		screen.queryByTestId("available-backups-section"),
	).not.toBeInTheDocument()
})
