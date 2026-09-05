import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { BackupSetup } from "./BackupSetup"
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
	policy: { withinHours: 24, daily: 7, weekly: 4, monthly: 12 },
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
		"sync.summary": () => ({ devices: [], remindDays: 7 }),
		"sync.current": () => ({}),
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

it("guides a new backup without asking for a recovery key first", async () => {
	const initialize = vi.fn(async () => ({ id: "backup-job" }))
	const started = vi.fn()
	mount(
		<BackupSetup
			backupRoot="Configured folder"
			repositoryPath="Configured folder/local"
			onStarted={started}
		/>,
		{
			"protection.initialize": initialize,
		},
	)
	const user = userEvent.setup()
	expect(
		screen.queryByLabelText("Existing repository recovery key (optional)"),
	).not.toBeInTheDocument()
	await user.click(screen.getByTestId("setup-new-backup"))
	expect(screen.getByText(/Large libraries take longer/)).toBeInTheDocument()
	expect(initialize).not.toHaveBeenCalled()
	await user.click(screen.getByTestId("initialize-backups"))
	await waitFor(() =>
		expect(initialize).toHaveBeenCalledWith({ recoveryKey: undefined }),
	)
	expect(started).toHaveBeenCalledOnce()
})

it("requires a recovery key when opening an existing backup", async () => {
	const initialize = vi.fn(async () => null)
	mount(
		<BackupSetup
			backupRoot="Configured folder"
			repositoryPath="Configured folder/local"
			onStarted={() => {}}
		/>,
		{
			"protection.initialize": initialize,
		},
	)
	const user = userEvent.setup()
	await user.click(
		screen.getByRole("button", { name: "Open an existing backup" }),
	)
	expect(screen.getByTestId("initialize-backups")).toBeDisabled()
	await user.upload(
		screen.getByLabelText("Choose recovery key file"),
		new File(
			[JSON.stringify({ key: "my-secret", format: "hoardodile-restic-v1" })],
			"recovery.json",
			{ type: "application/json" },
		),
	)
	await waitFor(() =>
		expect(screen.getByTestId("initialize-backups")).toBeEnabled(),
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

it("distinguishes first-backup progress from a completed backup", async () => {
	mount(<RecoveryPanel />, {
		"protection.jobs": () => [
			{
				id: "first",
				kind: "backup",
				state: "running",
				createdAt: 1700000000000,
			},
		],
	})
	expect(await screen.findByTestId("backup-summary")).toHaveTextContent(
		"Creating the first backup",
	)
	expect(screen.queryByText(/Last completed backup:/)).not.toBeInTheDocument()
	expect(screen.getByTestId("complete-backup-now")).toBeDisabled()
	expect(screen.getByTestId("recovery-key-notice")).toBeVisible()
})

it("starts a daily manual backup directly while advanced tools remain collapsed", async () => {
	const backup = vi.fn(async () => ({ id: "job" }))
	mount(<RecoveryPanel />, {
		"protection.points": () => [point],
		"protection.backup": backup,
	})
	const user = userEvent.setup()
	await screen.findByTestId("backup-summary")
	expect(screen.getByTestId("backup-management")).not.toHaveAttribute("open")
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
			links: {},
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

it("starts sync setup from the device's purpose and keeps external records separate", async () => {
	const configure = vi.fn(async () => ({}))
	mount(<ReplicationPanel />, {
		"replication.status": () => ({
			name: "Laptop",
			role: "unconfigured",
			paused: false,
			peers: [],
			source: null,
			links: {},
		}),
		"replication.configure": configure,
	})
	const user = userEvent.setup()
	await user.click(
		await screen.findByRole("button", {
			name: "Receive another device's backups",
		}),
	)
	await waitFor(() =>
		expect(configure).toHaveBeenCalledWith({
			role: "receive",
			name: "Laptop",
			paused: false,
		}),
	)
	expect(screen.getByTestId("external-sync-records")).not.toHaveAttribute(
		"open",
	)
})

it("gives a next step for low disk space while keeping diagnostic details collapsed", async () => {
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
	expect(await screen.findByText(/Not enough free space/)).toBeVisible()
	expect(screen.getByText("Native diagnostic")).not.toBeVisible()
})
