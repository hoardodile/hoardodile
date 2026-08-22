import { randomBytes } from "node:crypto"
import type { SidecarLayout } from "./paths.ts"

const WINDOWS_ENV_KEYS = [
	"PATH",
	"PATHEXT",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"TEMP",
	"TMP",
	"USERPROFILE",
	"HOME",
	"APPDATA",
	"LOCALAPPDATA",
	"PROGRAMDATA",
	"NUMBER_OF_PROCESSORS",
	"PROCESSOR_ARCHITECTURE",
] as const

export type SidecarEnvOptions = {
	readonly layout: SidecarLayout
	readonly libraryPath: string
	readonly port: number
	readonly sharedFolderRoot: string
	readonly sharedFolderEnabled: boolean
	readonly shutdownToken: string
}

export function createShutdownToken(): string {
	return randomBytes(32).toString("hex")
}

/**
 * Complete env for the Node sidecar. Packaged runs skip the workspace
 * `.env`; every path here is absolute.
 */
export function buildSidecarEnv(
	options: SidecarEnvOptions,
	inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const {
		layout,
		libraryPath,
		port,
		sharedFolderRoot,
		sharedFolderEnabled,
		shutdownToken,
	} = options
	const env: NodeJS.ProcessEnv = {}
	for (const key of WINDOWS_ENV_KEYS) {
		const value = inherited[key]
		if (value !== undefined) env[key] = value
	}
	env.NODE_ENV = layout.packaged ? "production" : "development"
	env.HOST = "127.0.0.1"
	env.PORT = String(port)
	env.STORAGE_ROOT = libraryPath
	env.BUILTIN_PATH = layout.builtinPath
	env.SEED_PLUGIN_PATHS = layout.seedPluginPaths.join(",")
	env.DISABLE_DEV_PLUGINS = "true"
	if (sharedFolderEnabled) env.SHARED_FOLDER_ROOT = sharedFolderRoot
	env.HOARDODILE_PACKAGED = "1"
	env.HOARDODILE_SHUTDOWN_TOKEN = shutdownToken
	env.SESSION_SECURE_COOKIE = "false"
	env.FORCE_HTTPS = "false"
	return env
}
