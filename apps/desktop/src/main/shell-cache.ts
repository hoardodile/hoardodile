import { readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import type { Session } from "electron"

/**
 * Shell cache management — the Electron session caches of the app window
 * (Chromium HTTP disk cache, V8 code cache, shader caches) plus the
 * electron-updater download cache. Deliberately scoped to caches only:
 * cookies, localStorage and IndexedDB are user data and never touched
 * (see the storages whitelist — never an omnibus `clearStorageData`).
 */

export type ShellCacheSession = Pick<
	Session,
	"getCacheSize" | "clearCache" | "clearCodeCaches" | "clearStorageData"
>

export type ShellCacheDeps = {
	readonly session: ShellCacheSession
	/** electron-updater's download cache dir (`%LOCALAPPDATA%/<app>-updater`). */
	readonly updaterCacheDir: string | undefined
	/** False keeps a downloading / ready-to-install update package in place. */
	readonly canClearUpdaterCache: boolean
}

/** Recursive directory size in bytes; missing or unreadable dirs count as 0. */
export async function dirSize(dir: string | undefined): Promise<number> {
	if (dir === undefined) return 0
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
	let total = 0
	for (const entry of entries) {
		if (entry.isDirectory()) {
			total += await dirSize(join(dir, entry.name))
		} else if (entry.isFile()) {
			try {
				total += (await stat(join(dir, entry.name))).size
			} catch {
				// unreadable entry — count nothing
			}
		}
	}
	return total
}

/**
 * electron-updater's cache dir name formula — `sanitizedName.toLowerCase()
 * + "-updater"` — under the platform cache base (`%LOCALAPPDATA%` on
 * Windows; the desktop shell is Windows-only).
 */
export function resolveUpdaterCacheDir(options: {
	readonly localAppData: string | undefined
	readonly appName: string
}): string {
	const base = options.localAppData ?? ""
	return join(base, `${options.appName.toLowerCase()}-updater`)
}

/** Delete the updater download cache; electron-updater recreates it on demand. */
export async function clearUpdateCacheDir(
	dir: string | undefined,
): Promise<void> {
	if (dir === undefined) return
	await rm(dir, { recursive: true, force: true })
}

/** Current total: Chromium session cache + updater download cache. */
export async function getShellCacheSize(deps: ShellCacheDeps): Promise<number> {
	const sessionSize = await deps.session.getCacheSize().catch(() => 0)
	return sessionSize + (await dirSize(deps.updaterCacheDir))
}

/**
 * Clear the shell caches and report the bytes freed. The updater cache is
 * skipped when a download is in flight or an update sits ready to install.
 */
export async function clearShellCache(deps: ShellCacheDeps): Promise<number> {
	const before = await getShellCacheSize(deps)
	await deps.session.clearCache()
	// Empty `urls` clears every entry (Electron docs); the renderer is the
	// only origin class here and its code cache is always regenerable.
	await deps.session.clearCodeCaches({ urls: [] })
	// Whitelist only cache-like storages. Do NOT clearStorageData() without
	// `storages`: that would wipe cookies, localStorage and IndexedDB.
	await deps.session.clearStorageData({
		storages: ["shadercache", "cachestorage", "serviceworkers"],
	})
	if (deps.canClearUpdaterCache) {
		await clearUpdateCacheDir(deps.updaterCacheDir)
	}
	const after = await getShellCacheSize(deps)
	return Math.max(0, before - after)
}
