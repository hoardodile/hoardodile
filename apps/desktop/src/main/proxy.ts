import {
	describeProxy,
	resolveProxyConfig,
	toProxyRules,
} from "@hoardodile/shared/net-proxy"
import { session } from "electron"

/** electron-updater's session partition — see its `electronHttpExecutor`. */
const UPDATER_PARTITION = "electron-updater"

/**
 * Mirror the app-wide outbound proxy config onto Electron's network
 * stack. `net.fetch` (resource feeds, dest-window API proxy) and
 * electron-updater's partition session both run on Chromium, which
 * follows the OS system proxy by itself — this only adds env-var /
 * explicit (`HOARDODILE_PROXY`) proxies into the stack so every external
 * desktop request shares the same resolution as the server sidecar.
 * No-op for system-proxy ("Chromium already does it") and direct setups.
 */
export async function applyDesktopProxy(): Promise<void> {
	const config = resolveProxyConfig(process.env, process.platform)
	console.info(`[proxy] ${describeProxy(config)}`)
	if (config.source === "system" || config.source === "none") {
		return
	}
	const rules = toProxyRules(config)
	if (rules === null) return
	const targets: Electron.Session[] = [
		session.defaultSession,
		// `{ cache: false }` matches electron-updater's own partition
		// creation options; both calls resolve to the same partition.
		session.fromPartition(UPDATER_PARTITION, { cache: false }),
	]
	for (const target of targets) {
		try {
			await target.setProxy(rules)
		} catch (err) {
			console.warn(
				`[proxy] failed to apply ${describeProxy(config)}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}
}
