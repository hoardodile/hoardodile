/**
 * Pure decision logic for the update channel: which payload (resource
 * pack vs full installer) the release manifest asks the client to apply,
 * or nothing, and which layers of the pack need downloading. No imports
 * from Electron — unit-testable and platform agnostic by construction.
 */

/** Per-layer definition; the client mirrors `LAYER_SPECS` of the builder. */
export type ResourceLayer = {
	readonly name: string
	/** Content hash of the installed-layer root (same algorithm as shellHash). */
	readonly identity: string
	readonly payload: {
		readonly fileName: string
		readonly sha256: string
		readonly size: number
	}
}

/** The resource-pack feed manifest (resources-pack-<platform>-<arch>.json). */
export type ResourcePackManifest = {
	readonly schema: number
	readonly version: string
	readonly platform: string
	readonly arch: string
	readonly shellHash: string
	readonly electronVersion: string
	readonly installedYaml: string
	/** The resources-version.json content the applied tree must carry. */
	readonly marker: {
		readonly schema: number
		readonly version: string
		readonly nodeVersion: string
		readonly platform: string
		readonly arch: string
	}
	readonly bundled: {
		readonly node: string
		readonly server: string
		readonly plugins: readonly string[]
	}
	readonly layers: readonly ResourceLayer[]
}

/**
 * Where each layer lives on disk (relative to `resources/`) and how its
 * identity is computed. MUST stay in sync with PACK_LAYERS in
 * apps/desktop/scripts/build-resources-pack.mjs.
 */
export const LAYER_SPECS: Record<
	string,
	{ readonly root: readonly string[]; readonly exclude?: readonly string[] }
> = {
	node: { root: ["node"] },
	"server-dist": { root: ["server"], exclude: ["node_modules"] },
	"server-node_modules": { root: ["server", "node_modules"] },
	plugins: { root: ["plugins"] },
}

export type LocalUpdateState = {
	/** The installed shell's app version (app.getVersion()). */
	readonly appVersion: string
	/** Applied resource-payload version; `null` = the installer's shipped tree. */
	readonly resourceVersion: string | null
	/** Hash of the installed shell bundle; `undefined` when uncomputable (dev). */
	readonly shellHash: string | undefined
	/** process.versions.electron. */
	readonly electronVersion: string
}

export type UpdatePlan = "none" | "resources" | "full"

/**
 * Decide what a newer release means for this client:
 * - the manifest is older or equal to what's installed → nothing;
 * - shell runtime (main/preload bundle modules, `.map` and the wizard page
 *   excluded — content-only churn must not count) and Electron runtime are
 *   byte-identical to the manifest's → the resource pack can replace the
 *   sidecar payload in place (layers carry node/ server/ plugins/ and the
 *   marker);
 * - anything else (shell runtime changed, Electron bumped, channel disabled
 *   in this install shape) → the full installer path, as before.
 */
export function decideChannel(
	manifest: ResourcePackManifest,
	local: LocalUpdateState,
	support: { readonly available: boolean },
): UpdatePlan {
	if (!support.available) return "full"
	const installed = local.resourceVersion ?? local.appVersion
	if (compareVersions(manifest.version, installed) <= 0) return "none"
	if (local.shellHash === undefined) return "full"
	if (
		manifest.shellHash === local.shellHash &&
		manifest.electronVersion === local.electronVersion
	) {
		return "resources"
	}
	return "full"
}

/**
 * Why {@link decideChannel} chose the plan it did — a stable, loggable
 * reason so a "full" fallback is never a mystery. Mirrors the exact
 * branch order of {@link decideChannel}; keep the two in sync.
 */
export type ChannelReason =
	| "up-to-date"
	| "pack-available"
	| "no-support"
	| "no-shell-hash"
	| "shell-changed"
	| "electron-changed"

export function decideChannelReason(
	manifest: ResourcePackManifest,
	local: LocalUpdateState,
	support: { readonly available: boolean },
): ChannelReason {
	if (!support.available) return "no-support"
	const installed = local.resourceVersion ?? local.appVersion
	if (compareVersions(manifest.version, installed) <= 0) return "up-to-date"
	if (local.shellHash === undefined) return "no-shell-hash"
	const shell = manifest.shellHash === local.shellHash
	const electron = manifest.electronVersion === local.electronVersion
	if (shell && electron) return "pack-available"
	if (!electron) return "electron-changed"
	return "shell-changed"
}

/**
 * Which layers must be downloaded vs copied from the installed tree:
 * - identity equal → the installed content is already this layer's —
 *   copy it into the staging tree (the swap unit is the whole top-level
 *   directory, so skipping means copying, never omitting);
 * - identity missing/different → download + verify + extract.
 */
export function neededLayers(
	manifest: ResourcePackManifest,
	installedIdentities: Readonly<Record<string, string | undefined>>,
): {
	readonly download: readonly ResourceLayer[]
	readonly copy: readonly ResourceLayer[]
} {
	const download: ResourceLayer[] = []
	const copy: ResourceLayer[] = []
	for (const layer of manifest.layers) {
		if (installedIdentities[layer.name] === layer.identity) copy.push(layer)
		else download.push(layer)
	}
	return { download, copy }
}

/** Strict `X.Y.Z` comparison; unparseable sides compare equal (safe → none). */
export function compareVersions(a: string, b: string): number {
	const pa = parseVersion(a)
	const pb = parseVersion(b)
	for (let i = 0; i < 3; i++) {
		const delta = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (delta !== 0) return delta
	}
	return 0
}

function parseVersion(value: string): number[] {
	const parts = value.split(".").map((part) => {
		const n = Number.parseInt(part, 10)
		return Number.isFinite(n) ? n : 0
	})
	return parts.length === 3 ? parts : [0, 0, 0]
}

/** Runtime guard for the fetched manifest JSON (never trust the wire). */
export function isResourcePackManifest(
	value: unknown,
): value is ResourcePackManifest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false
	}
	const record = value as Record<string, unknown>
	if (
		record.schema !== 1 ||
		typeof record.version !== "string" ||
		typeof record.platform !== "string" ||
		typeof record.arch !== "string" ||
		typeof record.shellHash !== "string" ||
		typeof record.electronVersion !== "string" ||
		typeof record.installedYaml !== "string"
	) {
		return false
	}
	const marker = record.marker as Record<string, unknown> | undefined
	if (
		typeof marker !== "object" ||
		marker === null ||
		marker.schema !== 1 ||
		typeof marker.version !== "string" ||
		typeof marker.nodeVersion !== "string" ||
		typeof marker.platform !== "string" ||
		typeof marker.arch !== "string"
	) {
		return false
	}
	if (
		!Array.isArray(record.layers) ||
		record.layers.length === 0 ||
		record.layers.some((layer) => !isLayer(layer))
	) {
		return false
	}
	return true
}

function isLayer(value: unknown): value is ResourceLayer {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false
	}
	const layer = value as Record<string, unknown>
	const payload = layer.payload as Record<string, unknown> | undefined
	return (
		typeof layer.name === "string" &&
		typeof layer.identity === "string" &&
		typeof payload === "object" &&
		payload !== null &&
		typeof payload.fileName === "string" &&
		typeof payload.sha256 === "string" &&
		typeof payload.size === "number"
	)
}
