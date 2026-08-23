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
	copyLanAddress: () => void
}

export type TrayFlags = {
	readonly crashed: boolean
	readonly updateReady: boolean
	/** LAN share URL; `undefined` disables the copy menu item. */
	readonly lanUrl?: string | undefined
}

export type TrayStrings = {
	readonly open: string
	readonly changeLibrary: string
	readonly copyLanAddress: string
	readonly restartServer: string
	readonly updateReady: string
	readonly quit: string
	readonly tooltipServerStopped: string
	readonly tooltipUpdateReady: string
}

export function createAppTray(
	iconPath: string | undefined,
	handlers: TrayHandlers,
	flags: TrayFlags,
	strings: TrayStrings,
): Tray {
	const image =
		iconPath !== undefined && existsSync(iconPath)
			? nativeImage.createFromPath(iconPath)
			: nativeImage.createEmpty()
	const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
	rebuildTrayMenu(tray, handlers, flags, strings)
	tray.on("click", () => {
		handlers.openWindow()
	})
	return tray
}

export function rebuildTrayMenu(
	tray: Tray,
	handlers: TrayHandlers,
	flags: TrayFlags,
	strings: TrayStrings,
): void {
	const items: MenuItemConstructorOptions[] = [
		{ label: strings.open, click: () => handlers.openWindow() },
		{
			label: strings.changeLibrary,
			click: () => handlers.changeLibrary(),
		},
		{
			label: strings.copyLanAddress,
			enabled: flags.lanUrl !== undefined,
			click: () => handlers.copyLanAddress(),
		},
	]
	if (flags.crashed) {
		items.push({
			label: strings.restartServer,
			click: () => handlers.restartSidecar(),
		})
	}
	if (flags.updateReady) {
		items.push({ label: strings.updateReady, enabled: false })
	}
	items.push(
		{ type: "separator" },
		{ label: strings.quit, click: () => handlers.quit() },
	)
	tray.setContextMenu(Menu.buildFromTemplate(items))
	tray.setToolTip(
		flags.crashed
			? strings.tooltipServerStopped
			: flags.updateReady
				? strings.tooltipUpdateReady
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
