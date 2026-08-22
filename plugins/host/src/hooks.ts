import type {
	ImageHash,
	ImageHashesResult,
	PluginManifestId,
	SerializedFileList,
} from "@hoardodile/sdk-types"
import type { PluginRegistry, PluginRegistryEntry } from "./api-types.ts"
import { createCapabilityGuard } from "./capability-guard.ts"
import type { Detection, ResourceAPI } from "./types.ts"

/** Absolute cap of hash rows one resource may contribute (host policy). */
export const MAX_IMAGE_HASHES_PER_RESOURCE = 2000

/**
 * Run `detect` over the given registry entries in order; returns the id of
 * the first matching plugin, or `undefined` when none match. A throwing
 * detector is logged (tagged with `action`) and skipped — one crash must
 * never abort the scan.
 */
async function runDetectors(
	entries: readonly PluginRegistryEntry[],
	api: ResourceAPI,
	action: string,
): Promise<PluginManifestId | undefined> {
	for (const entry of entries) {
		const result = await invokeHook(entry, entry.plugin.detect, api, action)
		if (result?.ok) return entry.id
	}
	return undefined
}

/**
 * Invoke one hook of a registry entry with the uniform policy: an
 * unimplemented hook answers `undefined` without running, a throw is
 * logged via {@link hookFailureText} and also answers `undefined`. This
 * is the "throw means absence" policy — callers that must tell a hook
 * failure apart from a hook that ran (meta-hook key presence) keep
 * their own try/catch instead.
 */
async function invokeHook<T>(
	entry: PluginRegistryEntry,
	hook: ((api: ResourceAPI) => T | Promise<T>) | undefined,
	api: ResourceAPI,
	action: string,
	level: "warn" | "error" = "error",
): Promise<T | undefined> {
	if (hook === undefined) return undefined
	try {
		return await hook(api)
	} catch (err) {
		const log = level === "warn" ? console.warn : console.error
		log(hookFailureText(action, entry.id, err))
		return undefined
	}
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

function hookFailureText(
	action: string,
	pluginId: PluginManifestId,
	err: unknown,
): string {
	return `[plugin-hooks] ${action} failed for plugin ${pluginId}: ${errorText(err)}`
}

export type PluginHooksDeps = {
	/**
	 * Live accessor for the current registry — called on every hook
	 * invocation so a `rescan()` replacing the registry never leaves
	 * consumers holding a stale snapshot.
	 */
	readonly getRegistry: () => PluginRegistry
}

/**
 * Result of {@link PluginHooks.runMetaHooks}. A present key means the hook
 * ran (permission granted + implemented); `value` is the raw hook result,
 * which may still be `undefined` when the hook itself returned nothing.
 */
export type PluginMetaHookResults = {
	readonly sourceMeta?: { readonly value: unknown }
	readonly searchMeta?: { readonly value: unknown }
}

/**
 * The single entry point for executing plugin hooks. Owns every
 * hook-invocation policy: priority iteration, builtin fallback, error
 * swallowing/logging, capability checks, and result validation.
 *
 * Methods receive a ready-built {@link ResourceAPI} — this module knows
 * nothing about resources, archives, or paths.
 */
export type PluginHooks = {
	/** The builtin fallback plugin id. Throws when no builtin is registered. */
	readonly defaultPluginId: () => PluginManifestId
	/**
	 * The registry entry that should serve a resource's read paths right
	 * now: the resource's stored plugin when it is healthy (registered,
	 * enabled, not missing), otherwise the builtin fallback plugin.
	 * Throws when no builtin is registered.
	 */
	readonly getEffectiveEntry: (
		resPluginId: PluginManifestId | null,
	) => PluginRegistryEntry
	/** Run all enabled plugins' detectors in priority order. Returns the first matching plugin id. Throws if no match (builtin should always match). */
	readonly detectFirstMatch: (api: ResourceAPI) => Promise<PluginManifestId>
	/** Validate that the current plugin still matches. Returns confirmed plugin id or falls back to builtin id. */
	readonly revalidate: (
		api: ResourceAPI,
		currentPluginId: PluginManifestId,
	) => Promise<PluginManifestId>
	/** Run a specific plugin's detector. */
	readonly detectForPlugin: (
		api: ResourceAPI,
		pluginId: PluginManifestId,
	) => Promise<Detection>
	/**
	 * Detector pass for folder-import candidates: non-builtin detectors in
	 * priority order, falling back to the builtin plugin without invoking
	 * its detector.
	 */
	readonly detectForImportDir: (api: ResourceAPI) => Promise<PluginManifestId>
	/**
	 * Ask the owning plugin for a custom file list. Returns `undefined`
	 * when the plugin has no file list hook (or it failed).
	 */
	readonly buildFileList: (
		api: ResourceAPI,
		pluginId: PluginManifestId,
	) => Promise<SerializedFileList | undefined>
	/** Ask the owning plugin which file should be used for the local cover. */
	readonly resolveLocalCoverSource: (
		api: ResourceAPI,
		pluginId: PluginManifestId,
	) => Promise<string | undefined>
	/**
	 * Run the capability-gated meta hooks (`sourceMeta`, `searchMeta`) of
	 * the owning plugin. Keys are absent when the permission is not
	 * granted or the hook is not implemented.
	 */
	readonly runMetaHooks: (
		api: ResourceAPI,
		pluginId: PluginManifestId,
	) => Promise<PluginMetaHookResults>
	/**
	 * True when the plugin's manifest grants `imageHashes` and the plugin
	 * implements the hook. Used to decide whether a missing hash state is
	 * a rebuild gap or the plugin's legitimate choice.
	 */
	readonly supportsImageHashes: (pluginId: PluginManifestId) => boolean
	/**
	 * Run the capability-gated `imageHashes` hook of the owning plugin.
	 * Resolves to `undefined` when the permission is not granted, the
	 * hook is not implemented, or it threw. The returned entries are
	 * shape-validated (hex values, per-resource cap).
	 */
	readonly runImageHashes: (
		api: ResourceAPI,
		pluginId: PluginManifestId,
	) => Promise<ImageHashesResult | undefined>
}

export function createPluginHooks(deps: PluginHooksDeps): PluginHooks {
	const { getRegistry } = deps
	const guard = createCapabilityGuard()

	function defaultPluginId(): PluginManifestId {
		const builtin = getRegistry().getBuiltin()
		if (builtin === undefined) {
			throw new Error(
				"No builtin plugin in registry — cannot determine default plugin",
			)
		}
		return builtin.id
	}

	function getEffectiveEntry(
		resPluginId: PluginManifestId | null,
	): PluginRegistryEntry {
		if (resPluginId !== null) {
			const entry = getRegistry().getById(resPluginId)
			if (entry?.enabled === true && !entry.missing) {
				return entry
			}
		}
		const builtin = getRegistry().getBuiltin()
		if (builtin === undefined) {
			throw new Error(
				"No builtin plugin in registry — cannot determine effective plugin",
			)
		}
		return builtin
	}

	async function detectFirstMatch(api: ResourceAPI): Promise<PluginManifestId> {
		const matched = await runDetectors(
			getRegistry().getEnabled(),
			api,
			"detect",
		)
		if (matched !== undefined) return matched
		const builtin = getRegistry().getBuiltin()
		throw new Error(
			`No plugin matched resource. Builtin plugin ${builtin?.id ?? "unknown"} should have matched but did not.`,
		)
	}

	async function revalidate(
		api: ResourceAPI,
		currentPluginId: PluginManifestId,
	): Promise<PluginManifestId> {
		const registry = getRegistry()
		const builtin = registry.getBuiltin()
		if (builtin === undefined) {
			throw new Error("No builtin plugin available for fallback")
		}

		const enabled = registry.getEnabled()
		const startIndex = enabled.findIndex((e) => e.id === currentPluginId)
		if (startIndex < 0) {
			return builtin.id
		}

		const matched = await runDetectors(
			enabled.slice(startIndex),
			api,
			"revalidate detect",
		)
		return matched ?? builtin.id
	}

	async function detectForPlugin(
		api: ResourceAPI,
		pluginId: PluginManifestId,
	): Promise<Detection> {
		const entry = getRegistry().getById(pluginId)
		if (entry === undefined) {
			return { ok: false, reasons: [`unknown plugin: ${pluginId}`] }
		}
		const result = await invokeHook(
			entry,
			entry.plugin.detect,
			api,
			"detectForPlugin",
		)
		if (result === undefined) {
			return { ok: false, reasons: ["detect threw an exception"] }
		}
		if (result.ok) return { ok: true }
		return { ok: false, reasons: result.reasons.slice() }
	}

	async function detectForImportDir(
		api: ResourceAPI,
	): Promise<PluginManifestId> {
		const fallback = defaultPluginId()
		const detectors = getRegistry()
			.getEnabled()
			.filter((e) => !e.builtin)
			.sort((a, b) => a.priority - b.priority)
		const matched = await runDetectors(detectors, api, "import detect")
		return matched ?? fallback
	}

	async function buildFileList(
		api: ResourceAPI,
		pluginId: PluginManifestId,
	): Promise<SerializedFileList | undefined> {
		const entry = getRegistry().getById(pluginId)
		if (entry === undefined) return undefined
		const pluginResult = await invokeHook(
			entry,
			entry.plugin.listFiles,
			api,
			"listFiles",
		)
		if (pluginResult === undefined) return undefined
		for (const item of pluginResult) {
			if (typeof item === "string") continue
			if (typeof item === "object" && item !== null && !Array.isArray(item)) {
				for (const value of Object.values(item)) {
					if (value === undefined) continue
					const t = typeof value
					if (t === "string" || t === "number" || t === "boolean") continue
					throw new Error(
						`Plugin ${String(pluginId)} returned an invalid file list item value type: ${t}`,
					)
				}
				continue
			}
			throw new Error(
				`Plugin ${String(pluginId)} returned an invalid file list item`,
			)
		}
		return pluginResult as SerializedFileList
	}

	async function resolveLocalCoverSource(
		api: ResourceAPI,
		pluginId: PluginManifestId,
	): Promise<string | undefined> {
		const entry = getRegistry().getById(pluginId)
		if (entry === undefined) return undefined
		return invokeHook(entry, entry.plugin.coverLocal, api, "coverLocal", "warn")
	}

	async function runMetaHooks(
		api: ResourceAPI,
		pluginId: PluginManifestId,
	): Promise<PluginMetaHookResults> {
		const entry = getRegistry().getById(pluginId)
		if (entry === undefined) return {}
		const { manifest, plugin } = entry
		const results: {
			sourceMeta?: { readonly value: unknown }
			searchMeta?: { readonly value: unknown }
		} = {}
		/**
		 * Run one capability-gated meta hook. A present result key means
		 * the hook ran; a throw leaves the key absent (a failed hook must
		 * not wipe previously computed meta — the patch stays stale).
		 */
		async function runMetaHook(
			name: "sourceMeta" | "searchMeta",
		): Promise<void> {
			const hook = plugin[name]
			if (!guard.check(manifest, name) || hook === undefined) return
			try {
				results[name] = { value: await hook(api) }
			} catch (err) {
				console.error(hookFailureText(name, pluginId, err))
			}
		}
		await runMetaHook("sourceMeta")
		await runMetaHook("searchMeta")
		return results
	}

	function entrySupportsImageHashes(entry: PluginRegistryEntry): boolean {
		return (
			guard.check(entry.manifest, "imageHashes") &&
			entry.plugin.imageHashes !== undefined
		)
	}

	function supportsImageHashes(pluginId: PluginManifestId): boolean {
		const entry = getRegistry().getById(pluginId)
		return entry !== undefined && entrySupportsImageHashes(entry)
	}

	async function runImageHashes(
		api: ResourceAPI,
		pluginId: PluginManifestId,
	): Promise<ImageHashesResult | undefined> {
		const entry = getRegistry().getById(pluginId)
		if (entry === undefined || !entrySupportsImageHashes(entry))
			return undefined
		return sanitizeImageHashes(
			await invokeHook(entry, entry.plugin.imageHashes, api, "imageHashes"),
			pluginId,
		)
	}

	return {
		defaultPluginId,
		getEffectiveEntry,
		detectFirstMatch,
		revalidate,
		detectForPlugin,
		detectForImportDir,
		buildFileList,
		resolveLocalCoverSource,
		runMetaHooks,
		supportsImageHashes,
		runImageHashes,
	}
}

const HEX_VALUE = /^[0-9a-f]+$/

/**
 * Validate the raw hook result: a `{ hashes }` shape, hex string values,
 * and a bounded row count (excess entries are dropped with a warning —
 * the hook must never be able to bloat the hashes table).
 */
function sanitizeImageHashes(
	value: unknown,
	pluginId: string,
): ImageHashesResult | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const hashes = (value as { hashes?: unknown }).hashes
	if (!Array.isArray(hashes)) return undefined
	const valid: ImageHash[] = []
	for (const item of hashes) {
		if (typeof item !== "object" || item === null) continue
		const { scope, type, value: hex, bits } = item as Record<string, unknown>
		if (
			typeof scope === "string" &&
			scope.length > 0 &&
			typeof type === "string" &&
			type.length > 0 &&
			typeof hex === "string" &&
			HEX_VALUE.test(hex)
		) {
			// `bits` always defaults to the hex length (4 bits per char) so
			// consumers can classify perceptual vs exact hashes by bits.
			valid.push({
				scope,
				type,
				value: hex,
				bits:
					typeof bits === "number" && Number.isInteger(bits) && bits > 0
						? bits
						: hex.length * 4,
			})
		}
	}
	if (valid.length > MAX_IMAGE_HASHES_PER_RESOURCE) {
		console.warn(
			`[plugin-hooks] imageHashes for plugin ${pluginId} produced ${valid.length} entries — capped at ${MAX_IMAGE_HASHES_PER_RESOURCE}`,
		)
		valid.length = MAX_IMAGE_HASHES_PER_RESOURCE
	}
	return { hashes: valid }
}
