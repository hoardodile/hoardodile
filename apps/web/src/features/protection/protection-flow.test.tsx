import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { BackupManagement } from "./BackupManagement"
import { ProtectionJobs } from "./ProtectionJobs"
import { ReceivedBackup } from "./ReceivedBackup"
import { RecoveryPanel } from "./RecoveryPanel"
import { ReplicationPanel } from "./ReplicationPanel"

const clients: QueryClient[] = []
const instanceId = "97ca94be-5c84-411e-b67d-d80e20f0077b"
const sourceId = "68332aa4-ae02-4bc1-a69c-07ff27a2d9dd"
const pointId = "3c7d894c-6e45-4f7c-b6b4-927dcc7a0ef2"
const point = {
	id: pointId,
	createdAt: 1700000000000,
	name: "Laptop backup",
	note: "",
	kind: "manual",
	pinned: true,
}
const status = {
	instanceId,
	repositories: [{ id: "local", name: "Local backups" }],
	enabled: true,
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
	content: ReactNode,
	handlers: Record<string, (input: unknown) => unknown> = {},
) {
	const routes: Record<string, (input: unknown) => unknown> = {
		"protection.status": () => status,
		"protection.points": () => [],
		"protection.jobs": () => [],
		"replication.status": () => ({
			role: "receive",
			name: "Laptop",
			paused: false,
			source: null,
			peers: [],
		}),
		"sync.summary": () => ({ remindDays: 7 }),
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
		<QueryClientProvider client={client}>{content}</QueryClientProvider>,
	)
}

/** The Backups tab composition (recovery panel leads with the health verdict). */
function Page() {
	return <RecoveryPanel />
}

it("guides a new backup without asking for a recovery key first", async () => {
	const initialize = vi.fn(async () => ({ id: "backup-job" }))
	mount(<Page />, {
		"protection.status": () => ({ ...status, repositories: [] }),
		"protection.initialize": initialize,
		"replication.status": () => ({
			role: "unconfigured",
			name: "Laptop",
			paused: false,
			source: null,
			peers: [],
		}),
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("setup-new-backup"))
	expect(screen.getByText(/Large libraries take longer/)).toBeInTheDocument()
	expect(screen.queryByLabelText("Recovery passphrase")).not.toBeInTheDocument()
	expect(initialize).not.toHaveBeenCalled()
	await user.click(screen.getByTestId("initialize-backups"))
	await waitFor(() =>
		expect(initialize).toHaveBeenCalledWith({ recoveryKey: undefined }),
	)
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("requires a recovery key when opening an existing backup", async () => {
	const initialize = vi.fn(async () => null)
	mount(<Page />, {
		"protection.status": () => ({ ...status, repositories: [] }),
		"protection.initialize": initialize,
		"replication.status": () => ({
			role: "unconfigured",
			name: "Laptop",
			paused: false,
			source: null,
			peers: [],
		}),
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("setup-existing-backup"))
	expect(
		screen.getByLabelText("Choose recovery passphrase file"),
	).toBeInTheDocument()
	expect(screen.getByTestId("initialize-backups")).toBeDisabled()
	await user.upload(
		screen.getByLabelText("Choose recovery passphrase file"),
		new File(
			[JSON.stringify({ key: "my-secret", format: "hoardodile-restic-v1" })],
			"recovery.json",
			{ type: "application/json" },
		),
	)
	await waitFor(() =>
		expect(screen.getByTestId("initialize-backups")).toBeEnabled(),
	)
	await waitFor(() =>
		expect(screen.getByTestId("recovery-key-file-name")).toHaveTextContent(
			"recovery.json",
		),
	)
	await user.click(screen.getByTestId("initialize-backups"))
	await waitFor(() =>
		expect(initialize).toHaveBeenCalledWith({
			recoveryKey: JSON.stringify({
				key: "my-secret",
				format: "hoardodile-restic-v1",
			}),
		}),
	)
})

it("surfaces first-backup progress in the health header", async () => {
	mount(<Page />, {
		"protection.jobs": () => [
			{
				id: "first",
				kind: "backup",
				state: "running",
				createdAt: 1700000000000,
			},
		],
	})
	expect(
		await screen.findByTestId("backup-health-backupNow"),
	).toBeInTheDocument()
	expect(screen.getByTestId("complete-backup-now")).toBeDisabled()
	expect(screen.getByTestId("recovery-key-notice")).toBeVisible()
})

it("starts a manual backup directly while the advanced settings stay closed", async () => {
	const backup = vi.fn(async () => ({ id: "job" }))
	mount(<Page />, {
		"protection.points": () => [point],
		"protection.backup": backup,
	})
	const user = userEvent.setup()
	await screen.findByTestId("complete-backup-now")
	expect(screen.getByTestId("backup-retention")).toBeInTheDocument()
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	await user.click(screen.getByTestId("complete-backup-now"))
	await waitFor(() =>
		expect(backup).toHaveBeenCalledWith({
			name: "",
			note: "",
			kind: "manual",
			pinned: true,
		}),
	)
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("opens a received backup's exact restore plan without automatically applying it", async () => {
	const prepare = vi.fn(async () => ({ id: "plan", point }))
	const restore = vi.fn()
	mount(
		<ReceivedBackup
			source={{ id: sourceId, name: "Office PC", receivedAt: Date.now() }}
		/>,
		{
			"protection.status": () => ({
				...status,
				repositories: [{ id: sourceId, name: "Office PC" }],
			}),
			"protection.points": () => [point],
			"protection.prepareRestore": prepare,
			"protection.restore": restore,
		},
	)
	const user = userEvent.setup()
	await screen.findByText(/Receiving this backup does not change/)
	expect(prepare).not.toHaveBeenCalled()
	expect(restore).not.toHaveBeenCalled()
	await user.click(
		screen.getByRole("button", { name: "Use this backup on this device" }),
	)
	await waitFor(() =>
		expect(prepare).toHaveBeenCalledWith({ repositoryId: sourceId, pointId }),
	)
	expect(await screen.findByTestId("full-restore-submit")).toBeDisabled()
	expect(screen.getByText("Backup source: Office PC")).toBeInTheDocument()
	expect(restore).not.toHaveBeenCalled()
})

it("shows the waiting state when a paired source has no completed backup", async () => {
	mount(
		<ReceivedBackup
			source={{ id: sourceId, name: "Office PC", receivedAt: null }}
		/>,
	)
	expect(
		await screen.findByText(/Waiting for the first completed backup/),
	).toBeInTheDocument()
	expect(
		screen.queryByRole("button", { name: "Use this backup on this device" }),
	).not.toBeInTheDocument()
})

it("connects from one pasted invitation and preserves its certificate pin", async () => {
	const connect = vi.fn(async () => ({}))
	mount(<ReplicationPanel />, {
		"replication.status": () => ({
			name: "Laptop",
			role: "receive",
			paused: false,
			peers: [],
			source: null,
		}),
		"replication.connect": connect,
	})
	const user = userEvent.setup()
	await user.click(
		await screen.findByRole("button", { name: "Connect to sender" }),
	)
	await user.click(screen.getByLabelText("Paste pairing invitation"))
	await user.paste(
		JSON.stringify({
			format: "hoardodile-pair-v1",
			url: "https://192.168.1.10:3443/",
			code: "a".repeat(32),
			fingerprint: "b".repeat(64),
			expiresAt: Date.now() + 60000,
		}),
	)
	const buttons = screen.getAllByRole("button", { name: "Connect to sender" })
	await user.click(buttons.at(-1)!)
	await waitFor(() =>
		expect(connect).toHaveBeenCalledWith({
			url: "https://192.168.1.10:3443/",
			code: "a".repeat(32),
			fingerprint: "b".repeat(64),
		}),
	)
})

it("starts sync setup from the device's purpose without external records", async () => {
	const configure = vi.fn(async () => ({}))
	mount(<ReplicationPanel />, {
		"replication.status": () => ({
			name: "Laptop",
			role: "unconfigured",
			paused: false,
			peers: [],
			source: null,
		}),
		"replication.configure": configure,
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("setup-sync-receive"))
	await user.click(await screen.findByRole("button", { name: "Confirm" }))
	await waitFor(() =>
		expect(configure).toHaveBeenCalledWith({
			role: "receive",
			name: "Laptop",
			paused: false,
		}),
	)
	// The manual external-record management is gone; paired devices only.
	expect(screen.queryByTestId("external-sync-records")).not.toBeInTheDocument()
	expect(screen.queryByTestId("sync-device-add")).not.toBeInTheDocument()
})

it("hides the share option until a local backup exists", async () => {
	mount(<ReplicationPanel />, {
		"protection.status": () => ({
			...status,
			repositories: [{ id: "local", name: "Local backups" }],
		}),
		"replication.status": () => ({
			name: "Laptop",
			role: "unconfigured",
			paused: false,
			peers: [],
			source: null,
		}),
	})
	await screen.findByTestId("setup-sync-receive")
	expect(screen.queryByTestId("setup-sync-send")).not.toBeInTheDocument()
	expect(
		screen.getByText(/Create a local backup first to share/),
	).toBeInTheDocument()
})

it("shows the share option once a local backup exists", async () => {
	mount(<ReplicationPanel />, {
		"protection.status": () => ({
			...status,
			repositories: [{ id: "local", name: "Local backups" }],
			lastBackupAt: 1_700_000_000_000,
		}),
		"replication.status": () => ({
			name: "Laptop",
			role: "unconfigured",
			paused: false,
			peers: [],
			source: null,
		}),
	})
	await screen.findByTestId("setup-sync-send")
	expect(screen.getByTestId("setup-sync-receive")).toBeInTheDocument()
	expect(
		screen.queryByText(/Create a local backup first to share/),
	).not.toBeInTheDocument()
})

it("opens the invitation dialog before an address is known instead of crashing", async () => {
	mount(<ReplicationPanel />, {
		"protection.status": () => ({
			...status,
			repositories: [{ id: "local", name: "Local backups" }],
			lastBackupAt: 1_700_000_000_000,
		}),
		"replication.status": () => ({
			name: "Laptop",
			role: "send",
			paused: false,
			peers: [],
			source: null,
		}),
		"replication.invitation": () => ({
			code: "a".repeat(32),
			expiresAt: 1_700_000_600_000,
			instanceId,
		}),
	})
	const user = userEvent.setup()
	await user.click(
		await screen.findByRole("button", { name: "Create pairing invitation" }),
	)
	const dialog = await screen.findByRole("dialog")
	// The test origin is http, so no sender address is known yet: the dialog
	// must still render (asking for the address) rather than throw out of the
	// invitation formatter and take the whole pairing panel down.
	expect(
		within(dialog).getByText(/Enable HTTPS LAN sharing/),
	).toBeInTheDocument()
	expect(
		within(dialog).getByRole("button", { name: "Copy pairing invitation" }),
	).toBeDisabled()
	// The raw invitation fields live behind a button, never a disclosure
	// triangle: collapsed first, then revealed inline inside the dialog.
	const details = within(dialog).getByTestId("replication-details")
	expect(details).toHaveAttribute("aria-expanded", "false")
	expect(
		within(dialog).queryByLabelText("Pairing code"),
	).not.toBeInTheDocument()
	await user.click(details)
	expect(details).toHaveAttribute("aria-expanded", "true")
	expect(within(dialog).getByLabelText("Pairing code")).toHaveValue(
		"a".repeat(32),
	)
	expect(document.querySelector("details")).toBeNull()
})

it("hides the sender role option in the Role dropdown without a local backup", async () => {
	mount(<ReplicationPanel />, {
		"protection.status": () => ({
			...status,
			repositories: [{ id: "local", name: "Local backups" }],
		}),
		"replication.status": () => ({
			name: "Laptop",
			role: "receive",
			paused: false,
			peers: [],
			source: null,
		}),
	})
	const user = userEvent.setup()
	await user.click(await screen.findByRole("button", { name: "Role" }))
	await screen.findByRole("menuitemradio", {
		name: "Hold another device's backups",
	})
	expect(
		screen.queryByRole("menuitemradio", {
			name: "Share this device's backups",
		}),
	).not.toBeInTheDocument()
	expect(
		screen.getByRole("menuitemradio", {
			name: "Choose how to use this device",
		}),
	).toBeInTheDocument()
})

it("shows the sender role option in the Role dropdown once a local backup exists", async () => {
	mount(<ReplicationPanel />, {
		"protection.status": () => ({
			...status,
			repositories: [{ id: "local", name: "Local backups" }],
			lastBackupAt: 1_700_000_000_000,
		}),
		"replication.status": () => ({
			name: "Laptop",
			role: "receive",
			paused: false,
			peers: [],
			source: null,
		}),
	})
	const user = userEvent.setup()
	await user.click(await screen.findByRole("button", { name: "Role" }))
	await screen.findByRole("menuitemradio", {
		name: "Share this device's backups",
	})
	expect(
		screen.getByRole("menuitemradio", {
			name: "Hold another device's backups",
		}),
	).toBeInTheDocument()
})

it("switches to the connect flow after choosing to hold another device's backups", async () => {
	let role: "unconfigured" | "send" | "receive" = "unconfigured"
	const configure = vi.fn(async (input: unknown) => {
		role = (input as { role: "receive" }).role
		return {}
	})
	mount(<RecoveryPanel />, {
		"protection.status": () => ({ ...status, repositories: [] }),
		"replication.status": () => ({
			name: "Laptop",
			role,
			paused: false,
			source: null,
			peers: [],
		}),
		"replication.configure": configure,
	})
	const user = userEvent.setup()
	const receive = await screen.findByTestId("setup-sync-receive")
	await waitFor(() => expect(receive).toBeEnabled())
	await user.click(receive)
	await waitFor(() =>
		expect(configure).toHaveBeenCalledWith({
			role: "receive",
			name: "Laptop",
			paused: false,
		}),
	)
	// After the role flips to receive, the setup grid is replaced by the sync
	// service's connect-to-sender flow.
	expect(
		await screen.findByRole("button", { name: "Connect to sender" }),
	).toBeInTheDocument()
	expect(screen.queryByTestId("setup-new-backup")).not.toBeInTheDocument()
	expect(screen.getByTestId("backup-sync")).toBeInTheDocument()
})

it("gives a next step for low disk space and opens the technical details on demand", async () => {
	mount(<ProtectionJobs activeOnly />, {
		"protection.jobs": () => [
			{
				id: "failed",
				kind: "backup",
				state: "failed",
				createdAt: 1700000000000,
				error: { code: "low_disk", message: "Native diagnostic" },
			},
		],
	})
	const user = userEvent.setup()
	expect(await screen.findByText(/Not enough free space/)).toBeVisible()
	expect(screen.queryByText("Native diagnostic")).not.toBeInTheDocument()
	await user.click(screen.getByRole("button", { name: "Technical details" }))
	expect(await screen.findByText("Native diagnostic")).toBeVisible()
})

it("renders the unified settings sections without a page-level heading", async () => {
	mount(<RecoveryPanel />, {
		"protection.points": () => [point],
	})
	await screen.findByTestId("available-backups-section")
	expect(
		screen.queryByRole("heading", { name: "Complete backups" }),
	).not.toBeInTheDocument()
	expect(screen.getByTestId("complete-backups-section")).toBeInTheDocument()
	expect(screen.getByTestId("available-backups-section")).toBeInTheDocument()
	expect(
		screen.queryByTestId("recent-operations-section"),
	).not.toBeInTheDocument()
	expect(screen.getByTestId("complete-backups")).toBeInTheDocument()
})

it("hides the available-backups section when there are no recovery points", async () => {
	mount(<RecoveryPanel />)
	await screen.findByTestId("complete-backups-section")
	expect(
		screen.queryByTestId("available-backups-section"),
	).not.toBeInTheDocument()
})

it("shows a skeleton while the protection status loads", async () => {
	mount(<RecoveryPanel />, {
		"protection.status": () => new Promise<never>(() => {}),
	})
	expect(await screen.findByTestId("backups-skeleton")).toBeInTheDocument()
	expect(
		screen.queryByTestId("complete-backups-section"),
	).not.toBeInTheDocument()
	expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("merges local and offsite protection into one section", async () => {
	mount(<RecoveryPanel />, {
		"protection.points": () => [point],
	})
	const section = within(await screen.findByTestId("complete-backups-section"))
	expect(section.getByText("On this device")).toBeInTheDocument()
	expect(section.queryByText("Offsite copy")).not.toBeInTheDocument()
	expect(await section.findByTestId("backup-sync")).toBeInTheDocument()
})

it("offers three setup options when there is no local backup", async () => {
	const configure = vi.fn(async () => ({}))
	mount(<RecoveryPanel />, {
		"protection.status": () => ({ ...status, repositories: [] }),
		"replication.status": () => ({
			role: "unconfigured",
			name: "Laptop",
			paused: false,
			source: null,
			peers: [],
		}),
		"replication.configure": configure,
	})
	const user = userEvent.setup()
	expect(await screen.findByTestId("setup-new-backup")).toBeInTheDocument()
	expect(screen.getByTestId("setup-existing-backup")).toBeInTheDocument()
	const receive = screen.getByTestId("setup-sync-receive")
	expect(receive).toBeInTheDocument()
	expect(screen.queryByTestId("setup-sync-send")).not.toBeInTheDocument()
	expect(screen.queryByTestId("backup-sync")).not.toBeInTheDocument()
	await waitFor(() => expect(receive).toBeEnabled())
	await user.click(receive)
	await waitFor(() =>
		expect(configure).toHaveBeenCalledWith({
			role: "receive",
			name: "Laptop",
			paused: false,
		}),
	)
})

it("renders only the restore list while in restore-only mode", async () => {
	mount(<RecoveryPanel restoreOnly />, {
		"protection.points": () => [point],
	})
	await screen.findByTestId("available-backups-section")
	expect(
		screen.queryByTestId("complete-backups-section"),
	).not.toBeInTheDocument()
	expect(
		screen.queryByTestId("recent-operations-section"),
	).not.toBeInTheDocument()
	expect(screen.getByTestId("complete-backups")).toBeInTheDocument()
})

it("renders the sync service settings as labeled rows", async () => {
	mount(<ReplicationPanel />, {
		"replication.status": () => ({
			name: "Laptop",
			role: "receive",
			paused: false,
			peers: [],
			source: null,
		}),
	})
	await screen.findByLabelText("Service name")
	expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
	expect(screen.getByText("Role")).toBeInTheDocument()
	expect(
		screen.getByRole("switch", { name: "Pause backup sync" }),
	).toBeInTheDocument()
	expect(
		screen.getByRole("button", { name: "Connect to sender" }),
	).toBeInTheDocument()
})

it("renders the backup-sync area as two unified sections without a page-level heading", async () => {
	mount(<ReplicationPanel />, {
		"replication.status": () => ({
			name: "Laptop",
			role: "receive",
			paused: false,
			peers: [
				{
					id: "peer-1",
					name: "Backup drive",
					receivedAt: Date.now(),
				},
			],
			source: null,
		}),
	})
	await screen.findByText("Backup drive")
	expect(
		screen.queryByRole("heading", { name: "Backup sync" }),
	).not.toBeInTheDocument()
	expect(screen.getByTestId("replication-devices-section")).toBeInTheDocument()
	expect(screen.getByTestId("backup-sync")).toBeInTheDocument()
})

it("changes the automatic backup frequency from the backups section", async () => {
	const interval = vi.fn(async () => 6)
	mount(<Page />, { "protection.interval": interval })
	const user = userEvent.setup()
	const select = await screen.findByTestId("backup-frequency")
	expect(select).toHaveTextContent("Daily")
	await user.click(select)
	await user.click(
		await screen.findByRole("menuitemradio", { name: "Every 6 hours" }),
	)
	expect(interval).toHaveBeenCalledWith({ hours: 6 })
})

it("edits the retention policy in its own dialog", async () => {
	const policy = vi.fn(async () => ({ automatic: 5 }))
	mount(<BackupManagement repositoryId="local" />, {
		"protection.policy": policy,
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("backup-retention"))
	const dialog = within(await screen.findByRole("dialog"))
	const save = dialog.getByRole("button", { name: "Save" })
	expect(save).toBeDisabled()
	const count = dialog.getByLabelText("Automatic backups to keep")
	await user.clear(count)
	await user.type(count, "5")
	expect(save).toBeEnabled()
	await user.click(save)
	expect(policy).toHaveBeenCalledWith({ automatic: 5 })
})

it("runs repository checks and exports the recovery key from the advanced dialog", async () => {
	const check = vi.fn(async () => ({ ok: true, readData: true }))
	const key = vi.fn(async () => ({
		repositoryId: "local",
		key: "recovery-key",
	}))
	// jsdom has no blob-URL factory — the key export downloads through one.
	Object.defineProperty(URL, "createObjectURL", {
		writable: true,
		configurable: true,
		value: vi.fn(() => "blob:mock-key"),
	})
	Object.defineProperty(URL, "revokeObjectURL", {
		writable: true,
		configurable: true,
		value: vi.fn(),
	})
	mount(<BackupManagement repositoryId="local" />, {
		"protection.check": check,
		"protection.recoveryKey": key,
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("backup-checks"))
	const dialog = within(await screen.findByRole("dialog"))
	expect(dialog.getByText(/Last full verification/)).toBeInTheDocument()
	await user.click(
		dialog.getByRole("button", { name: "Verify all backup data" }),
	)
	expect(check).toHaveBeenCalledWith({ repositoryId: "local", readData: true })
	await user.click(dialog.getByRole("button", { name: "Export recovery key" }))
	await waitFor(() =>
		expect(key).toHaveBeenCalledWith({ repositoryId: "local" }),
	)
})

it("previews the cleanup, then applies it with storage reclaim from the confirmation", async () => {
	const retention = vi.fn(async () => ({ removed: 2 }))
	const expired = [
		{
			id: "0b2a4c6e-1f3a-4b5c-8d7e-9f0a1b2c3d4e",
			createdAt: 1_700_000_000_000,
			name: "Oldest automatic",
			note: "",
			kind: "auto",
			pinned: false,
		},
		{
			id: "1c3b5d7f-2a4b-4c6d-9e8f-0a1b2c3d4e5f",
			createdAt: 1_700_000_600_000,
			name: "",
			note: "",
			kind: "auto",
			pinned: false,
		},
	]
	mount(<BackupManagement repositoryId="local" />, {
		"protection.previewRetention": () => expired,
		"protection.retention": retention,
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("backup-cleanup"))
	const dialog = within(await screen.findByRole("dialog"))
	expect(await dialog.findByText("Oldest automatic")).toBeInTheDocument()
	const confirm = dialog.getByRole("button", { name: "Remove expired points" })
	expect(confirm).toBeEnabled()
	await user.click(
		dialog.getByRole("checkbox", { name: "Also reclaim unused storage" }),
	)
	await user.click(confirm)
	expect(retention).toHaveBeenCalledWith({
		repositoryId: "local",
		prune: true,
	})
})

it("keeps cleanup disabled while nothing has expired", async () => {
	mount(<BackupManagement repositoryId="local" />, {
		"protection.previewRetention": () => [],
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("backup-cleanup"))
	const dialog = within(await screen.findByRole("dialog"))
	await waitFor(() =>
		expect(
			dialog.getByRole("button", { name: "Remove expired points" }),
		).toBeDisabled(),
	)
})

it("hides the retention and cleanup rows for a received repository", async () => {
	mount(<BackupManagement repositoryId={sourceId} />)
	expect(await screen.findByTestId("backup-checks")).toBeInTheDocument()
	expect(screen.queryByTestId("backup-retention")).not.toBeInTheDocument()
	expect(screen.queryByTestId("backup-cleanup")).not.toBeInTheDocument()
})
