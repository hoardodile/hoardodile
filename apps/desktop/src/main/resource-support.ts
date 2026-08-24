import { existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Runtime capability probe for the resource-pack channel.
 *
 * The single client-side policy table: install shapes map to channel
 * behavior, derived from runtime facts (never a platform name scattered
 * through the code). A read-only `resources/` (Program Files install,
 * AppImage mount, future signed bundle) closes the channel through the
 * writability probe alone; adding a new install shape is one entry.
 * Keep in sync with the build-side policy
 * (scripts/lib/resource-pack-targets.mjs).
 */

export type InstallShape =
	| "nsis"
	| "portable"
	| "appImage"
	| "dmg"
	| "unpackaged"

/** Feed asset name segment per platform — mirrors the build-side slugs. */
export function resourcePackSlug(
	platform: NodeJS.Platform,
): string | undefined {
	if (platform === "win32") return "win"
	if (platform === "linux") return "linux"
	if (platform === "darwin") return "mac"
	return undefined
}

export type ResourceSupportReason =
	| "read-only"
	| "portable"
	| "unpackaged"
	| "unsupported-install"

export type ResourceSupport =
	| { readonly available: true }
	| { readonly available: false; readonly reason: ResourceSupportReason }

const INSTALL_POLICY: Record<InstallShape, "resources" | "full"> = {
	nsis: "resources",
	portable: "full",
	appImage: "full",
	dmg: "full",
	unpackaged: "full",
}

export function detectInstallShape(options: {
	readonly packaged: boolean
	readonly portable: boolean
	readonly platform: NodeJS.Platform
}): InstallShape {
	if (!options.packaged) return "unpackaged"
	if (options.portable) return "portable"
	if (options.platform === "win32") return "nsis"
	if (options.platform === "linux") return "appImage"
	return "dmg"
}

export function resourceUpdateSupport(options: {
	readonly packaged: boolean
	readonly portable: boolean
	readonly platform: NodeJS.Platform
	/** Directory that would be swapped in place (process.resourcesPath). */
	readonly resourcesRoot: string
}): ResourceSupport {
	const shape = detectInstallShape(options)
	if (INSTALL_POLICY[shape] !== "resources") {
		const reason: ResourceSupportReason =
			shape === "unpackaged"
				? "unpackaged"
				: shape === "portable"
					? "portable"
					: "unsupported-install"
		return { available: false, reason }
	}
	return probeWritable(options.resourcesRoot)
}

/** Write+delete a probe file: the only reliable "can we swap here?" test. */
export function probeWritable(dir: string): ResourceSupport {
	try {
		const probe = join(dir, `.hoardodile-probe-${process.pid}-${Date.now()}`)
		writeFileSync(probe, "probe", { flag: "wx" })
		rmSync(probe, { force: true })
		return { available: true }
	} catch {
		return { available: false, reason: "read-only" }
	}
}

/** The staged entries the pack carries; must match RESOURCE_PACK_ENTRIES. */
export const SWAP_ENTRIES = [
	"node",
	"server",
	"plugins",
	"resources-version.json",
] as const

export function swapMarkerPath(resourcesRoot: string): string {
	return join(resourcesRoot, ".swap-pending")
}

export function swapBackupRoot(resourcesRoot: string): string {
	return join(resourcesRoot, ".olds")
}

export function swapStagingRoot(
	resourcesRoot: string,
	version: string,
): string {
	return join(resourcesRoot, `.staging-${version}`)
}

export function resourceVersionMarkerPath(resourcesRoot: string): string {
	return join(resourcesRoot, "resources-version.json")
}

export function markerExists(resourcesRoot: string): boolean {
	return existsSync(swapMarkerPath(resourcesRoot))
}
