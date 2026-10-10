import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { BackupStatusHeader } from "./BackupStatusHeader"

const clients: QueryClient[] = []
const instanceId = "97ca94be-5c84-411e-b67d-d80e20f0077b"
const localStatus = {
	instanceId,
	repositories: [{ id: "local", name: "Local backups" }],
	enabled: true,
	lastBackupAt: 1_700_000_000_000,
	backupRoot: "Configured folder",
	policy: { automatic: 3 },
	autoBackupIntervalHours: 24,
	storage: { frozen: false },
	lastRestore: null,
}

beforeAll(async () => {
	await i18n.changeLanguage("en")
})
afterEach(() => {
	for (const client of clients.splice(0)) client.clear()
	localStorage.clear()
})

function mount(
	handlers: Record<string, (input: unknown) => unknown> = {},
	onSetUpBackups = vi.fn(),
) {
	const routes: Record<string, (input: unknown) => unknown> = {
		"protection.status": () => localStatus,
		"protection.jobs": () => [],
		...handlers,
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
								query: async (input: unknown) =>
									routes[`${namespace}.${procedure}`]?.(input),
								mutate: async (input: unknown) =>
									routes[`${namespace}.${procedure}`]?.(input),
							}),
						},
					),
			},
		) as unknown as TRPCClient,
	)
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	clients.push(client)
	return render(
		<QueryClientProvider client={client}>
			<BackupStatusHeader onSetUpBackups={onSetUpBackups} />
		</QueryClientProvider>,
	)
}

it("reports a healthy local backup without paired devices", async () => {
	mount()
	expect(await screen.findByTestId("backup-health-ok")).toBeInTheDocument()
	expect(
		screen.getByText("Your library is backed up on this device."),
	).toBeInTheDocument()
})

it("prompts to set up backups when nothing is configured", async () => {
	const onSetUpBackups = vi.fn()
	mount(
		{
			"protection.status": () => ({ ...localStatus, repositories: [] }),
		},
		onSetUpBackups,
	)
	expect(
		await screen.findByTestId("backup-health-noBackups"),
	).toBeInTheDocument()
	const user = userEvent.setup()
	await user.click(screen.getByRole("button", { name: "Set up backups" }))
	expect(onSetUpBackups).toHaveBeenCalledOnce()
})

it("prompts to turn on automatic backups when backups are off", async () => {
	const enable = vi.fn(async () => ({}))
	mount({
		"protection.status": () => ({ ...localStatus, enabled: false }),
		"protection.enabled": enable,
	})
	expect(
		await screen.findByTestId("backup-health-backupOff"),
	).toBeInTheDocument()
	const user = userEvent.setup()
	await user.click(
		screen.getByRole("button", { name: "Turn on automatic backups" }),
	)
	await waitFor(() => expect(enable).toHaveBeenCalledWith({ enabled: true }))
})
