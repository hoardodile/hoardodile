import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import { setTrpcClient, type TRPCClient } from "@/trpc/client"
import { BackupFolderDialog } from "./BackupFolderDialog"
import { BackupManagement } from "./BackupManagement"
import { ProtectionJobs } from "./ProtectionJobs"
import { RecoveryPanel } from "./RecoveryPanel"
import { RestoreBackupButton } from "./RestoreBackupButton"

const desktop = vi.hoisted(() => ({ enabled: false, pickFolder: vi.fn() }))
vi.mock("@/lib/desktop", () => ({
	isHoardodileDesktop: () => desktop.enabled,
	getDesktopBridge: () =>
		desktop.enabled ? { pickBackupFolder: desktop.pickFolder } : undefined,
}))

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
	desktop.enabled = false
	desktop.pickFolder.mockReset()
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

it("requires a matching backup password for a new desktop backup", async () => {
	desktop.enabled = true
	const initialize = vi.fn(async () => ({ id: "backup-job" }))
	mount(<Page />, {
		"protection.status": () => ({ ...status, repositories: [] }),
		"protection.initialize": initialize,
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("setup-new-backup"))
	const submit = screen.getByTestId("initialize-backups")
	expect(submit).toBeDisabled()
	await user.type(screen.getByLabelText("Backup password"), "backup-password")
	await user.type(screen.getByLabelText("Confirm backup password"), "wrong")
	expect(submit).toBeDisabled()
	await user.clear(screen.getByLabelText("Confirm backup password"))
	await user.type(
		screen.getByLabelText("Confirm backup password"),
		"backup-password",
	)
	await user.click(submit)
	await waitFor(() =>
		expect(initialize).toHaveBeenCalledWith({
			recoveryKey: undefined,
			password: "backup-password",
		}),
	)
})

it("keeps external restore available during maintenance and opens its points without changing backup configuration", async () => {
	desktop.enabled = true
	desktop.pickFolder.mockResolvedValue({
		id: sourceId,
		path: "External backup",
		exists: true,
		purpose: "restore",
	})
	let opened = false
	const open = vi.fn(async () => {
		opened = true
		return { repositoryId: sourceId }
	})
	const change = vi.fn()
	mount(<RecoveryPanel restoreOnly />, {
		"protection.status": () => ({
			...status,
			repositories: opened
				? [
						{
							id: sourceId,
							name: "External",
							path: "External backup",
							restoreOnly: true,
						},
					]
				: [],
			maintenanceActive: true,
		}),
		"protection.points": () => [point],
		"protection.openRestoreSource": open,
		"protection.setBackupLocation": change,
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("restore-from-folder"))
	const dialog = within(screen.getByRole("dialog"))
	await user.click(dialog.getByRole("button", { name: "Choose backup folder" }))
	await user.type(
		await dialog.findByLabelText("Backup password"),
		"my-password",
	)
	await user.click(dialog.getByTestId("backup-folder-submit"))
	await waitFor(() =>
		expect(open).toHaveBeenCalledWith({
			selectionId: sourceId,
			credential: "my-password",
			credentialType: "password",
		}),
	)
	expect(
		await screen.findByTestId(`recovery-point-${pointId}`),
	).toBeInTheDocument()
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	expect(
		screen.queryByTestId(`recovery-point-menu-${pointId}`),
	).not.toBeInTheDocument()
	expect(change).not.toHaveBeenCalled()
})

it("creates a password-protected destination only after explicit confirmation", async () => {
	desktop.enabled = true
	desktop.pickFolder.mockResolvedValue({
		id: sourceId,
		path: "New backup",
		exists: false,
		purpose: "backup",
	})
	const change = vi.fn(async () => null)
	const open = vi.fn()
	mount(
		<BackupFolderDialog
			open
			purpose="backup"
			onOpenChange={() => {}}
			onSourceOpened={() => {}}
		/>,
		{
			"protection.setBackupLocation": change,
			"protection.openRestoreSource": open,
		},
	)
	const user = userEvent.setup()
	await user.click(screen.getByRole("button", { name: "Choose backup folder" }))
	await user.type(
		await screen.findByLabelText("Backup password"),
		"new-password",
	)
	await user.type(
		screen.getByLabelText("Confirm backup password"),
		"new-password",
	)
	expect(change).not.toHaveBeenCalled()
	await user.click(screen.getByTestId("backup-folder-submit"))
	await waitFor(() =>
		expect(change).toHaveBeenCalledWith({
			selectionId: sourceId,
			credential: undefined,
			credentialType: "password",
			password: "new-password",
		}),
	)
	expect(open).not.toHaveBeenCalled()
})

it("confirms desktop restores using the phrase returned for the selected language", async () => {
	desktop.enabled = true
	await i18n.changeLanguage("zh")
	try {
		const prepare = vi.fn(async () => ({
			id: "plan",
			point,
			confirmationPhrase: "还原",
			sourcePath: "External backup",
			targetPath: "Current library",
		}))
		const restore = vi.fn(async () => ({}))
		mount(
			<RestoreBackupButton
				repositoryId={sourceId}
				pointId={pointId}
				source="External"
			/>,
			{ "protection.prepareRestore": prepare, "protection.restore": restore },
		)
		const user = userEvent.setup()
		await user.click(screen.getByRole("button", { name: "还原" }))
		await waitFor(() =>
			expect(prepare).toHaveBeenCalledWith({
				repositoryId: sourceId,
				pointId,
				language: "zh",
			}),
		)
		expect(screen.getByText("还原目标：Current library")).toBeInTheDocument()
		await user.type(screen.getByTestId("full-restore-confirm"), "restore")
		expect(screen.getByTestId("full-restore-submit")).toBeDisabled()
		await user.clear(screen.getByTestId("full-restore-confirm"))
		await user.type(screen.getByTestId("full-restore-confirm"), "还原")
		await user.click(screen.getByTestId("full-restore-submit"))
		await waitFor(() =>
			expect(restore).toHaveBeenCalledWith({
				planId: "plan",
				confirmation: "还原",
			}),
		)
	} finally {
		await i18n.changeLanguage("en")
	}
})

it("guides a new backup without asking for a recovery key first", async () => {
	const initialize = vi.fn(async () => ({ id: "backup-job" }))
	mount(<Page />, {
		"protection.status": () => ({ ...status, repositories: [] }),
		"protection.initialize": initialize,
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

it("opens an existing repository's exact restore plan without automatically applying it", async () => {
	const prepare = vi.fn(async () => ({ id: "plan", point }))
	const restore = vi.fn()
	mount(
		<RestoreBackupButton
			repositoryId={sourceId}
			pointId={pointId}
			source="Office PC"
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
	await screen.findByRole("button", { name: "Restore" })
	expect(prepare).not.toHaveBeenCalled()
	expect(restore).not.toHaveBeenCalled()
	await user.click(screen.getByRole("button", { name: "Restore" }))
	await waitFor(() =>
		expect(prepare).toHaveBeenCalledWith({ repositoryId: sourceId, pointId }),
	)
	expect(await screen.findByTestId("full-restore-submit")).toBeDisabled()
	expect(screen.getByText("Backup source: Office PC")).toBeInTheDocument()
	expect(restore).not.toHaveBeenCalled()
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

it("keeps recent operations behind a button that opens the job dialog", async () => {
	mount(<RecoveryPanel />, {
		"protection.points": () => [point],
		"protection.jobs": () => [
			{
				id: "job-1",
				kind: "backup",
				state: "succeeded",
				createdAt: 1700000000000,
			},
		],
	})
	const user = userEvent.setup()
	const open = await screen.findByTestId("recent-operations-open")
	// The page shows one control, not a standing list. The control says just
	// "View": the row's own title already names what it opens.
	expect(open).toHaveTextContent("View")
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	expect(screen.queryByTestId("protection-job-job-1")).not.toBeInTheDocument()

	await user.click(open)
	const dialog = await screen.findByTestId("recent-operations-dialog")
	expect(within(dialog).getByTestId("protection-job-job-1")).toBeInTheDocument()
	expect(dialog).toHaveTextContent("Recent operations")
})

it("pages the operations dialog at five jobs per page", async () => {
	mount(<RecoveryPanel />, {
		"protection.points": () => [point],
		"protection.jobs": () =>
			Array.from({ length: 12 }, (_, index) => ({
				id: `job-${index}`,
				kind: "backup",
				state: "succeeded",
				createdAt: 1700000000000 - index * 1000,
			})),
	})
	const user = userEvent.setup()
	await user.click(await screen.findByTestId("recent-operations-open"))
	const dialog = await screen.findByTestId("recent-operations-dialog")
	await waitFor(() =>
		expect(within(dialog).getAllByTestId(/^protection-job-/)).toHaveLength(5),
	)
	expect(within(dialog).getByText("12 operations")).toBeInTheDocument()
	expect(within(dialog).getAllByTestId("pagination-bar")).toHaveLength(1)

	await user.click(within(dialog).getByRole("button", { name: "2" }))
	await waitFor(() =>
		expect(
			within(dialog).getByTestId("protection-job-job-5"),
		).toBeInTheDocument(),
	)
	expect(
		within(dialog).queryByTestId("protection-job-job-0"),
	).not.toBeInTheDocument()
})

it("pages the recovery points at 20 per page with a pager above and below", async () => {
	const many = Array.from({ length: 41 }, (_, index) => ({
		...point,
		id: `point-${index}`,
		name: `Backup ${index}`,
		createdAt: 1700000000000 + index * 1000,
	}))
	mount(<RecoveryPanel />, {
		"protection.points": () => many,
	})
	const user = userEvent.setup()

	const cards = () => screen.getAllByTestId(/^recovery-point-point-/)
	// Newest first: the first page holds the 20 latest points.
	await screen.findByTestId("available-backups-section")
	await waitFor(() => expect(cards()).toHaveLength(20))
	expect(screen.getByTestId("recovery-point-point-40")).toBeInTheDocument()
	expect(screen.queryByTestId("recovery-point-point-0")).not.toBeInTheDocument()
	expect(screen.getAllByTestId("pagination-bar")).toHaveLength(2)
	// The count label travels with both pagers.
	expect(screen.getAllByText("41 backups")).toHaveLength(2)

	// The bottom pager advances: page 2 holds the next 20, page 3 the last one.
	const bars = screen.getAllByTestId("pagination-bar")
	await user.click(
		within(bars[1] as HTMLElement).getByRole("button", { name: "Next" }),
	)
	await waitFor(() => expect(cards()).toHaveLength(20))
	expect(screen.getByTestId("recovery-point-point-1")).toBeInTheDocument()
	expect(
		screen.queryByTestId("recovery-point-point-40"),
	).not.toBeInTheDocument()
	expect(screen.getAllByTestId("pagination-current")[0]).toHaveTextContent("2")

	await user.click(
		within(screen.getAllByTestId("pagination-bar")[1] as HTMLElement).getByRole(
			"button",
			{ name: "Next" },
		),
	)
	await waitFor(() => expect(cards()).toHaveLength(1))
	expect(screen.getByTestId("recovery-point-point-0")).toBeInTheDocument()
	expect(screen.queryByTestId("recovery-point-point-1")).not.toBeInTheDocument()
})

it("shows no pager while every recovery point fits on one page", async () => {
	mount(<RecoveryPanel />, {
		"protection.points": () => [point],
	})
	await screen.findByTestId("available-backups-section")
	await screen.findByTestId(`recovery-point-${pointId}`)
	expect(screen.queryByTestId("pagination-bar")).not.toBeInTheDocument()
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

it("offers only local backup setup without device-sync controls", async () => {
	mount(<RecoveryPanel />, {
		"protection.status": () => ({ ...status, repositories: [] }),
	})
	expect(await screen.findByTestId("setup-new-backup")).toBeInTheDocument()
	expect(screen.getByTestId("setup-existing-backup")).toBeInTheDocument()
	expect(screen.queryByTestId("setup-sync-receive")).not.toBeInTheDocument()
	expect(screen.queryByTestId("setup-sync-send")).not.toBeInTheDocument()
	expect(screen.queryByTestId("backup-sync")).not.toBeInTheDocument()
})
