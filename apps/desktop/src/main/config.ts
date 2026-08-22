import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

export const DEFAULT_PORT = 3000

export type DesktopConfig = {
	wizardComplete: boolean
	libraryPath: string
	sharedFolderRoot: string
	sharedFolderEnabled: boolean
	port: number
	autoStart: boolean
	startInTray: boolean
	autoUpdate: boolean
}

const storedConfigSchema = z.object({
	wizardComplete: z.boolean(),
	libraryPath: z.string().min(1),
	sharedFolderRoot: z.string().min(1),
	sharedFolderEnabled: z.boolean(),
	port: z.number().int().min(1).max(65535),
	autoStart: z.boolean(),
	startInTray: z.boolean(),
	autoUpdate: z.boolean(),
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
		autoStart: false,
		startInTray: false,
		autoUpdate: true,
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
		autoStart: parsed.data.autoStart ?? defaults.autoStart,
		startInTray: parsed.data.startInTray ?? defaults.startInTray,
		autoUpdate: parsed.data.autoUpdate ?? defaults.autoUpdate,
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
