/**
 * Workbench-local override of a plugin's stored state.
 *
 * In dev the library is opened read-only (`packages/cli/src/storage.ts`),
 * so a plugin's `prefs` (its settings) and `cache` (per-resource entries)
 * are seeded from the real database and a plugin's writes only live in the
 * in-memory mock host. This module keeps a workbench-only override that,
 * when present, replaces that seeded baseline — the Configure popover's
 * Reset settings / Clear cache actions set it to `{}` (so the plugin sees
 * a clean slate) and Restore deletes it (so the library seed returns).
 *
 * Everything here is a pure function except `loadPluginStateOverrides` /
 * `savePluginStateOverrides`, which touch `localStorage` under a
 * workbench-only key (never an app pref key). A corrupt or absent value
 * falls back to an empty override, exactly like `config.ts` does for the
 * iframe presentation config.
 */

import type { ResourceContext } from "./context.ts"

export type PluginStateOverrides = {
	/** Per-plugin preference override. Present ⇒ used as the seed (empty after reset). */
	readonly prefs: Readonly<Record<string, Readonly<Record<string, string>>>>
	/** Per-(plugin, resource) cache override; keyed `${pluginId}::${resId}`. */
	readonly cache: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export const PLUGIN_STATE_STORAGE_KEY = "hoardodile.workbench.plugin-state"

/** The composite key for a (plugin, resource) cache override. */
export function cacheKey(pluginId: string, resId: string): string {
	return `${pluginId}::${resId}`
}

export function emptyOverrides(): PluginStateOverrides {
	return { prefs: {}, cache: {} }
}

/** The override for `pluginId`, or `seeded` when no override exists. */
export function prefsFor(
	state: PluginStateOverrides,
	pluginId: string,
	seeded: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	return state.prefs[pluginId] ?? seeded
}

/** The override for the plugin+resource cache, or `seeded` when none exists. */
export function cacheFor(
	state: PluginStateOverrides,
	pluginId: string,
	resId: string,
	seeded: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	return state.cache[cacheKey(pluginId, resId)] ?? seeded
}

export function hasPrefOverride(
	state: PluginStateOverrides,
	pluginId: string,
): boolean {
	return Object.hasOwn(state.prefs, pluginId)
}

export function hasCacheOverride(
	state: PluginStateOverrides,
	pluginId: string,
	resId: string,
): boolean {
	return Object.hasOwn(state.cache, cacheKey(pluginId, resId))
}

/** Reset `pluginId`'s settings: the seed becomes empty. */
export function withClearedPrefs(
	state: PluginStateOverrides,
	pluginId: string,
): PluginStateOverrides {
	return { ...state, prefs: { ...state.prefs, [pluginId]: {} } }
}

/** Clear the plugin+resource cache: its seed becomes empty. */
export function withClearedCache(
	state: PluginStateOverrides,
	pluginId: string,
	resId: string,
): PluginStateOverrides {
	return {
		...state,
		cache: { ...state.cache, [cacheKey(pluginId, resId)]: {} },
	}
}

/** Restore `pluginId`'s settings seed (drop the override). */
export function withoutPrefOverride(
	state: PluginStateOverrides,
	pluginId: string,
): PluginStateOverrides {
	return { ...state, prefs: omit(state.prefs, pluginId) }
}

/** Restore the plugin+resource cache seed (drop the override). */
export function withoutCacheOverride(
	state: PluginStateOverrides,
	pluginId: string,
	resId: string,
): PluginStateOverrides {
	return { ...state, cache: omit(state.cache, cacheKey(pluginId, resId)) }
}

/**
 * Apply the plugin-state override to a fetched context: when a Reset
 * settings / Clear cache override exists for this plugin (and resource),
 * it replaces the read-only seeded `prefs` / `cache` so the mounted plugin
 * sees the cleared baseline. Messages, danmaku, the hook snapshot and
 * capabilities pass through untouched.
 */
export function seedState(
	state: PluginStateOverrides,
	pluginId: string,
	resId: string,
	ctx: ResourceContext,
): ResourceContext {
	if (ctx.state === null) return ctx
	return {
		...ctx,
		state: {
			...ctx.state,
			prefs: prefsFor(state, pluginId, ctx.state.prefs ?? {}),
			cache: cacheFor(state, pluginId, resId, ctx.state.cache ?? {}),
		},
	}
}

function omit<T extends object>(
	record: T,
	deleted: keyof T,
): Record<keyof T, T[keyof T]> {
	const next = { ...record } as Record<keyof T, T[keyof T]>
	delete next[deleted]
	return next
}

function isRecordOfRecords(
	value: unknown,
): value is Readonly<Record<string, Readonly<Record<string, string>>>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false
	}
	for (const key of Object.keys(value)) {
		const entry = (value as Record<string, unknown>)[key]
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return false
		}
	}
	return true
}

function normalize(raw: unknown): PluginStateOverrides {
	const candidate =
		typeof raw === "object" && raw !== null
			? (raw as Partial<PluginStateOverrides>)
			: {}
	return {
		prefs: isRecordOfRecords(candidate.prefs) ? candidate.prefs : {},
		cache: isRecordOfRecords(candidate.cache) ? candidate.cache : {},
	}
}

/** Read the persisted override; a corrupt or absent value yields an empty override. */
export function loadPluginStateOverrides(): PluginStateOverrides {
	try {
		const raw = localStorage.getItem(PLUGIN_STATE_STORAGE_KEY)
		return raw === null ? emptyOverrides() : normalize(JSON.parse(raw))
	} catch {
		return emptyOverrides()
	}
}

export function savePluginStateOverrides(state: PluginStateOverrides): void {
	try {
		localStorage.setItem(PLUGIN_STATE_STORAGE_KEY, JSON.stringify(state))
	} catch {
		// Storage unavailable (private mode): the session still works.
	}
}
