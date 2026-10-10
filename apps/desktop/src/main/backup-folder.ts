import { type BrowserWindow, dialog } from "electron"
import { registerSidecarBackupFolder, type SidecarHandle } from "./sidecar.ts"

export async function pickBackupFolder(options: {
	sidecar: SidecarHandle | undefined
	parent: BrowserWindow
	purpose: "restore" | "backup"
}) {
	if (!options.sidecar) throw new Error("The local service is unavailable")
	const result = await dialog.showOpenDialog(options.parent, {
		properties:
			options.purpose === "backup"
				? ["openDirectory", "createDirectory"]
				: ["openDirectory"],
	})
	const path = result.filePaths[0]
	if (result.canceled || !path) return undefined
	return registerSidecarBackupFolder(options.sidecar, path, options.purpose)
}
