import type { PluginManifest } from "@hoardodile/sdk-types"
import { APP_VERSION } from "@/lib/appInfo"
import { compareVersions, isNewer } from "@/lib/versions"
import type { RouterOutputs } from "@/trpc/client"

type MarketPlugin = RouterOutputs["marketplace"]["snapshot"]["plugins"][number]

/**
 * Whether the host app satisfies the plugin's declared minimum version.
 * A missing or unparseable `minAppVersion` never blocks — the field is
 * optional and the value is shown verbatim when it cannot be ranked.
 */
export function isMinAppSatisfied(
	manifest: Pick<PluginManifest, "minAppVersion">,
	appVersion: string = APP_VERSION,
): boolean {
	const min = manifest.minAppVersion
	if (min === undefined) return true
	try {
		return compareVersions(appVersion, min) >= 0
	} catch {
		return true
	}
}

/**
 * Whether a marketplace plugin offers an update for the installed version:
 * the release is newer AND compatible with the current app. The single
 * source of truth shared by the card's ⋯ menu, the "Updates" filter and
 * the sidebar update badge.
 */
export function marketUpdateAvailable(
	plugin: {
		readonly state: MarketPlugin["state"]
		readonly latest?: { readonly version: string }
		readonly manifest: Pick<PluginManifest, "minAppVersion">
	},
	installedVersion: string | undefined,
	appVersion?: string,
): boolean {
	if (plugin.state !== "ok" || plugin.latest === undefined) return false
	if (installedVersion === undefined) return false
	if (!isNewer(plugin.latest.version, installedVersion)) return false
	return isMinAppSatisfied(plugin.manifest, appVersion)
}
