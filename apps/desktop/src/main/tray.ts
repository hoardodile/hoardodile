import { existsSync } from "node:fs"
import { join } from "node:path"
import {
	app,
	Menu,
	type MenuItemConstructorOptions,
	nativeImage,
	Tray,
} from "electron"

export type TrayHandlers = {
	openWindow: () => void
	changeLibrary: () => void
	quit: () => void
	restartSidecar: () => void
}

export type TrayFlags = {
	readonly crashed: boolean
	readonly updateReady: boolean
}

export function createAppTray(
	iconPath: string | undefined,
	handlers: TrayHandlers,
	flags: TrayFlags,
): Tray {
	const image =
		iconPath !== undefined && existsSync(iconPath)
			? nativeImage.createFromPath(iconPath)
			: nativeImage.createEmpty()
	const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
	rebuildTrayMenu(tray, handlers, flags)
	tray.on("click", () => {
		handlers.openWindow()
	})
	return tray
}

export function rebuildTrayMenu(
	tray: Tray,
	handlers: TrayHandlers,
	flags: TrayFlags,
): void {
	const items: MenuItemConstructorOptions[] = [
		{ label: "Open", click: () => handlers.openWindow() },
		{
			label: "Change library…",
			click: () => handlers.changeLibrary(),
		},
	]
	if (flags.crashed) {
		items.push({
			label: "Restart server",
			click: () => handlers.restartSidecar(),
		})
	}
	if (flags.updateReady) {
		items.push({ label: "Update ready — Open to restart", enabled: false })
	}
	items.push(
		{ type: "separator" },
		{ label: "Quit", click: () => handlers.quit() },
	)
	tray.setContextMenu(Menu.buildFromTemplate(items))
	tray.setToolTip(
		flags.crashed
			? "hoardodile — server stopped"
			: flags.updateReady
				? "hoardodile — update ready"
				: "hoardodile",
	)
}

function iconPathIn(resourcesPath: string, file: string): string | undefined {
	const packaged = join(resourcesPath, file)
	if (existsSync(packaged)) return packaged
	const dev = join(app.getAppPath(), "resources", file)
	if (existsSync(dev)) return dev
	return undefined
}

/** 512×512 window icon; also the exe/runtime icon in packaged layouts. */
export function windowIconPath(resourcesPath: string): string | undefined {
	return iconPathIn(resourcesPath, "icon.png")
}

/** 32×32 tray icon (Windows trays render 16–32 px; feeding 512 turns muddy). */
export function trayIconPath(resourcesPath: string): string | undefined {
	return iconPathIn(resourcesPath, "tray.png")
}
