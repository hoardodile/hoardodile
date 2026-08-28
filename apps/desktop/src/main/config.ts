import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

export const DEFAULT_PORT = 3000

export type CloseAction = "ask" | "tray" | "quit"

/**
 * One persistable app-window geometry. `x`/`y` are `null` when the
 * position was never captured (or became unusable); both are DIP.
 */
export type WindowBounds = {
	readonly x: number | null
	readonly y: number | null
	readonly width: number
	readonly height: number
}

export type DesktopConfig = {
	wizardComplete: boolean
	libraryPath: string
	sharedFolderRoot: string
	sharedFolderEnabled: boolean
	port: number
	/** Port the user last requested; `port` follows it unless a conflict fallback kicked in. */
	portPreferred: number
	lanEnabled: boolean
	autoStart: boolean
	startInTray: boolean
	/** What closing the app window does: ask, hide to tray, or quit the app. */
	closeAction: CloseAction
	/** Drop the session cookie on boot so every app launch starts at sign-in. */
	requireSignInOnLaunch: boolean
	/**
	 * Drop the session cookie whenever a fresh app window is created
	 * (tray reopen, second launch, recovery), not only at boot.
	 */
	requireSignInOnWindowOpen: boolean
	autoUpdate: boolean
	/** Version of the applied resource payload (server tree), `null` when still on the installer's tree. */
	resourceVersion: string | null
	/**
	 * Last app-window bounds (DIP), restored at the next window creation.
	 * `null` until a window has been captured once.
	 */
	windowBounds: WindowBounds | null
	/** Whether the app window was maximized when it was last captured. */
	windowMaximized: boolean
}

const windowBoundsSchema = z.object({
	x: z.number().int().nullish(),
	y: z.number().int().nullish(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
})

const storedConfigSchema = z.object({
	wizardComplete: z.boolean(),
	libraryPath: z.string().min(1),
	sharedFolderRoot: z.string().min(1),
	sharedFolderEnabled: z.boolean(),
	port: z.number().int().min(1).max(65535),
	portPreferred: z.number().int().min(1).max(65535),
	lanEnabled: z.boolean(),
	autoStart: z.boolean(),
	startInTray: z.boolean(),
	closeAction: z.enum(["ask", "tray", "quit"]),
	requireSignInOnLaunch: z.boolean(),
	requireSignInOnWindowOpen: z.boolean(),
	autoUpdate: z.boolean(),
	resourceVersion: z.string().nullable(),
	windowBounds: windowBoundsSchema.nullable().optional(),
	windowMaximized: z.boolean().optional(),
})

export function defaultDesktopConfig(
	libraryPath: string,
	sharedFolderRoot: string,
): DesktopConfig {
	return {
		wizardComplete: false,
		libraryPath,
		sharedFolderRoot,
		sharedFolderEnabled: false,
		port: DEFAULT_PORT,
		portPreferred: DEFAULT_PORT,
		lanEnabled: false,
		autoStart: false,
		startInTray: false,
		closeAction: "ask",
		// Locked by default: the stateless session cookie is dropped at
		// boot, so the app always opens at the sign-in screen.
		requireSignInOnLaunch: true,
		// Also locked by default: reopening the window (tray, second
		// launch) re-arms sign-in instead of restoring the session.
		requireSignInOnWindowOpen: true,
		// macOS is still shipped unsigned in this phase: electron-updater
		// refuses an unsigned download there, so auto-update must stay off
		// (the Settings page still runs a click-to-check) until signed &
		// notarized builds exist. Windows (verifyUpdateCodeSignature:
		// false) and Linux AppImage updates do not need a certificate.
		autoUpdate: process.platform !== "darwin",
		// No resource layer had been applied yet — the shipped tree is the
		// installer's. Set once the first resource update lands.
		resourceVersion: null,
		// No window geometry captured yet; the first resize/move/close
		// records it.
		windowBounds: null,
		windowMaximized: false,
	}
}

export function parseDesktopConfig(
	raw: unknown,
	libraryPath: string,
	sharedFolderRoot: string,
): DesktopConfig {
	const defaults = defaultDesktopConfig(libraryPath, sharedFolderRoot)
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return defaults
	}
	const parsed = storedConfigSchema.partial().safeParse(raw)
	if (!parsed.success) return defaults
	return {
		wizardComplete: parsed.data.wizardComplete ?? defaults.wizardComplete,
		libraryPath: parsed.data.libraryPath ?? defaults.libraryPath,
		sharedFolderRoot: parsed.data.sharedFolderRoot ?? defaults.sharedFolderRoot,
		sharedFolderEnabled:
			parsed.data.sharedFolderEnabled ?? defaults.sharedFolderEnabled,
		port: parsed.data.port ?? defaults.port,
		portPreferred: parsed.data.portPreferred ?? defaults.portPreferred,
		lanEnabled: parsed.data.lanEnabled ?? defaults.lanEnabled,
		autoStart: parsed.data.autoStart ?? defaults.autoStart,
		startInTray: parsed.data.startInTray ?? defaults.startInTray,
		closeAction: parsed.data.closeAction ?? defaults.closeAction,
		requireSignInOnLaunch:
			parsed.data.requireSignInOnLaunch ?? defaults.requireSignInOnLaunch,
		requireSignInOnWindowOpen:
			parsed.data.requireSignInOnWindowOpen ??
			defaults.requireSignInOnWindowOpen,
		autoUpdate: parsed.data.autoUpdate ?? defaults.autoUpdate,
		resourceVersion: parsed.data.resourceVersion ?? defaults.resourceVersion,
		windowBounds: normalizeWindowBounds(parsed.data.windowBounds),
		windowMaximized: parsed.data.windowMaximized ?? defaults.windowMaximized,
	}
}

/** Normalize a stored bounds object (x/y nullish → `null`). */
function normalizeWindowBounds(value: unknown): WindowBounds | null {
	if (value === undefined || value === null) return null
	const candidate = value as Partial<WindowBounds>
	if (
		typeof candidate.width !== "number" ||
		typeof candidate.height !== "number" ||
		!Number.isInteger(candidate.width) ||
		!Number.isInteger(candidate.height) ||
		candidate.width <= 0 ||
		candidate.height <= 0
	) {
		return null
	}
	return {
		x:
			typeof candidate.x === "number" && Number.isInteger(candidate.x)
				? candidate.x
				: null,
		y:
			typeof candidate.y === "number" && Number.isInteger(candidate.y)
				? candidate.y
				: null,
		width: candidate.width,
		height: candidate.height,
	}
}

export function readDesktopConfig(
	filePath: string,
	libraryPath: string,
	sharedFolderRoot: string,
): DesktopConfig {
	try {
		const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"))
		return parseDesktopConfig(raw, libraryPath, sharedFolderRoot)
	} catch {
		return defaultDesktopConfig(libraryPath, sharedFolderRoot)
	}
}

export function writeDesktopConfig(
	filePath: string,
	config: DesktopConfig,
): void {
	mkdirSync(dirname(filePath), { recursive: true })
	const tmp = join(dirname(filePath), "desktop.json.tmp")
	writeFileSync(tmp, `${JSON.stringify(config, null, "\t")}\n`, "utf8")
	renameSync(tmp, filePath)
}

export function configFilePath(userData: string): string {
	return join(userData, "desktop.json")
}
