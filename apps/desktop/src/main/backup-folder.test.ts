import { join } from "node:path"
import { BrowserWindow, dialog } from "electron"
import { afterEach, expect, it, vi } from "vitest"
import { pickBackupFolder } from "./backup-folder.ts"
import type { SidecarHandle } from "./sidecar.ts"

vi.mock("electron", () => ({
	BrowserWindow: class {},
	dialog: { showOpenDialog: vi.fn() },
}))
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
const sidecar: SidecarHandle = {
	port: 3000,
	url: "http://127.0.0.1:3000/",
	shutdownToken: "local-token",
	stop: async () => {},
	onCrash: () => () => {},
}

it("registers only the folder selected by the user and passes the sidecar token", async () => {
	const path = join(process.cwd(), "backup")
	vi.mocked(dialog.showOpenDialog).mockResolvedValue({
		canceled: false,
		filePaths: [path],
	})
	const fetch = vi.fn(async () =>
		Response.json({ id: "selection", path, exists: true, purpose: "restore" }),
	)
	vi.stubGlobal("fetch", fetch)
	const parent = new BrowserWindow()
	expect(
		await pickBackupFolder({ sidecar, parent, purpose: "restore" }),
	).toEqual({ id: "selection", path, exists: true, purpose: "restore" })
	expect(dialog.showOpenDialog).toHaveBeenCalledWith(parent, {
		properties: ["openDirectory"],
	})
	expect(fetch).toHaveBeenCalledWith(
		"http://127.0.0.1:3000/api/internal/protection/folder",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-shutdown-token": "local-token",
			},
			body: JSON.stringify({ path, purpose: "restore" }),
		},
	)
})

it("allows creating a backup destination and does not register a canceled selection", async () => {
	vi.mocked(dialog.showOpenDialog).mockResolvedValue({
		canceled: true,
		filePaths: [],
	})
	const fetch = vi.fn()
	vi.stubGlobal("fetch", fetch)
	const parent = new BrowserWindow()
	expect(
		await pickBackupFolder({ sidecar, parent, purpose: "backup" }),
	).toBeUndefined()
	expect(dialog.showOpenDialog).toHaveBeenCalledWith(parent, {
		properties: ["openDirectory", "createDirectory"],
	})
	expect(fetch).not.toHaveBeenCalled()
})
