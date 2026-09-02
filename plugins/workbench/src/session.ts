import type { Danmaku, Message } from "@hoardodile/sdk-types"
import type { ResourceContext } from "./context.ts"

/**
 * Workbench-local session state for the mounted plugin.
 *
 * In dev the library is opened read-only (`packages/cli/src/storage.ts`),
 * so a plugin's `prefs` (its settings) and `cache` (per-resource entries)
 * are seeded from the real database and a plugin's writes only live in the
 * in-memory mock host — until this module. It keeps a workbench-only
 * session that, once a plugin writes a pref/cache entry, records that
 * write so a page refresh re-seeds the same value (the mock host is
 * otherwise rebuilt from the read-only seed each mount).
 *
 * Four things are recorded, all keyed to survive a refresh:
 *
 * - `prefs` — per-plugin effective map. Once a write (or a Reset) touches
 *   a plugin it is seeded from the library prefs and then accumulates
 *   writes; Reset settings stores `{}` (a clean slate) and Restore deletes
 *   the entry (so the library seed returns).
 * - `cache` — per-(plugin, resource) effective map, keyed
 *   `${pluginId}::${resId}`, with the same override semantics.
 * - `messages` / `danmaku` — per-resource log of the rows a plugin created
 *   this session. Exactly like the app, the workbench starts the store from
 *   the resource's real comments/danmaku; rows created here are appended to
 *   that seed on each mount, so a refresh keeps both.
 *
 * Everything here is a pure function; the IndexedDB I/O lives in
 * `session-store.ts` (`createSessionStore`). A corrupt or absent stored
 * value collapses to an empty session field by field, exactly like
 * `config.ts` does for the iframe presentation config.
 */

export type WorkbenchSession = {
	/** Per-plugin preference override. Present ⇒ used as the seed (empty after reset). */
	readonly prefs: Readonly<Record<string, Readonly<Record<string, string>>>>
	/** Per-(plugin, resource) cache override; keyed `${pluginId}::${resId}`. */
	readonly cache: Readonly<Record<string, Readonly<Record<string, string>>>>
	/** Per-resource log of plugin-created messages (appended to the DB seed). */
	readonly messages: Readonly<Record<string, readonly Message[]>>
	/** Per-resource log of plugin-created danmaku (appended to the DB seed). */
	readonly danmaku: Readonly<Record<string, readonly Danmaku[]>>
}

/** The composite key for a (plugin, resource) cache override. */
export function cacheKey(pluginId: string, resId: string): string {
	return `${pluginId}::${resId}`
}

export function emptySession(): WorkbenchSession {
	return { prefs: {}, cache: {}, messages: {}, danmaku: {} }
}

/** The override for `pluginId`, or `seeded` when no override exists. */
export function prefsFor(
	session: WorkbenchSession,
	pluginId: string,
	seeded: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	return session.prefs[pluginId] ?? seeded
}

/** The override for the plugin+resource cache, or `seeded` when none exists. */
export function cacheFor(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
	seeded: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	return session.cache[cacheKey(pluginId, resId)] ?? seeded
}

/** The recorded (plugin-created) messages for `resId`. */
export function messagesFor(
	session: WorkbenchSession,
	resId: string,
): readonly Message[] {
	return session.messages[resId] ?? []
}

/** The recorded (plugin-created) danmaku for `resId`. */
export function danmakuFor(
	session: WorkbenchSession,
	resId: string,
): readonly Danmaku[] {
	return session.danmaku[resId] ?? []
}

export function hasPrefOverride(
	session: WorkbenchSession,
	pluginId: string,
): boolean {
	return Object.hasOwn(session.prefs, pluginId)
}

export function hasCacheOverride(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
): boolean {
	return Object.hasOwn(session.cache, cacheKey(pluginId, resId))
}

/**
 * True when `pluginId`'s prefs were explicitly reset (the stored map is the
 * empty `{}`), as opposed to merely holding recorded writes. Drives the
 * "cleared" status; the Restore button instead keys off
 * {@link hasPrefOverride} (any session state).
 */
export function isPrefsCleared(
	session: WorkbenchSession,
	pluginId: string,
): boolean {
	const map = session.prefs[pluginId]
	return map !== undefined && Object.keys(map).length === 0
}

/** See {@link isPrefsCleared}; scoped to a plugin+resource cache entry. */
export function isCacheCleared(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
): boolean {
	const map = session.cache[cacheKey(pluginId, resId)]
	return map !== undefined && Object.keys(map).length === 0
}

/** Reset `pluginId`'s settings: the seed becomes empty. */
export function withClearedPrefs(
	session: WorkbenchSession,
	pluginId: string,
): WorkbenchSession {
	return { ...session, prefs: { ...session.prefs, [pluginId]: {} } }
}

/** Clear the plugin+resource cache: its seed becomes empty. */
export function withClearedCache(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
): WorkbenchSession {
	return {
		...session,
		cache: { ...session.cache, [cacheKey(pluginId, resId)]: {} },
	}
}

/** Restore `pluginId`'s settings seed (drop the override + recorded writes). */
export function withoutPrefOverride(
	session: WorkbenchSession,
	pluginId: string,
): WorkbenchSession {
	return { ...session, prefs: omit(session.prefs, pluginId) }
}

/** Restore the plugin+resource cache seed (drop the override + recorded writes). */
export function withoutCacheOverride(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
): WorkbenchSession {
	return { ...session, cache: omit(session.cache, cacheKey(pluginId, resId)) }
}

/**
 * Record a plugin pref write into the session. The stored map is the
 * plugin's full effective prefs for `pluginId`: it is seeded from the
 * library value the first time anything touches that plugin (a write or a
 * Reset), then accumulates writes. Passing the library seed makes the
 * first write capture `{...seed}`, while a Reset-then-write keeps the
 * cleared (`{}`) baseline.
 */
export function recordPrefWrite(
	session: WorkbenchSession,
	pluginId: string,
	seed: Readonly<Record<string, string>>,
	key: string,
	value: string,
): WorkbenchSession {
	const base = session.prefs[pluginId] ?? seed
	return {
		...session,
		prefs: { ...session.prefs, [pluginId]: { ...base, [key]: value } },
	}
}

/** Record a plugin cache write, keyed `${pluginId}::${resId}`. See {@link recordPrefWrite}. */
export function recordCacheWrite(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
	seed: Readonly<Record<string, string>>,
	key: string,
	value: string,
): WorkbenchSession {
	const base = session.cache[cacheKey(pluginId, resId)] ?? seed
	return {
		...session,
		cache: {
			...session.cache,
			[cacheKey(pluginId, resId)]: { ...base, [key]: value },
		},
	}
}

/** Append a plugin-created message to the session log for `resId`. */
export function recordMessage(
	session: WorkbenchSession,
	resId: string,
	message: Message,
): WorkbenchSession {
	return {
		...session,
		messages: {
			...session.messages,
			[resId]: [...messagesFor(session, resId), message],
		},
	}
}

/** Append a plugin-created danmaku to the session log for `resId`. */
export function recordDanmaku(
	session: WorkbenchSession,
	resId: string,
	danmaku: Danmaku,
): WorkbenchSession {
	return {
		...session,
		danmaku: {
			...session.danmaku,
			[resId]: [...danmakuFor(session, resId), danmaku],
		},
	}
}

/**
 * Apply the session to a fetched context: when a Reset settings / Clear
 * cache override exists for this plugin (and resource), it replaces the
 * read-only seeded `prefs` / `cache`; recorded writes are merged the same
 * way, and the plugin-created message/danmaku logs are appended to the
 * resource's real ones. The hook snapshot and capabilities pass through
 * untouched.
 */
export function seedState(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
	ctx: ResourceContext,
): ResourceContext {
	if (ctx.state === null && !hasSessionState(session, pluginId, resId)) {
		return ctx
	}
	const base = ctx.state ?? {}
	return {
		...ctx,
		state: {
			...base,
			prefs: prefsFor(session, pluginId, base.prefs ?? {}),
			cache: cacheFor(session, pluginId, resId, base.cache ?? {}),
			messages: appendLog(base.messages, messagesFor(session, resId)),
			danmaku: appendLog(base.danmaku, danmakuFor(session, resId)),
		},
	}
}

/**
 * True when the session holds any state for this plugin (and resource) —
 * a pref/cache override (which may be an empty reset map) or a recorded
 * message/danmaku. With no dev-server DB state this is what lets a session
 * write still re-seed on refresh.
 */
function hasSessionState(
	session: WorkbenchSession,
	pluginId: string,
	resId: string,
): boolean {
	return (
		hasPrefOverride(session, pluginId) ||
		hasCacheOverride(session, pluginId, resId) ||
		messagesFor(session, resId).length > 0 ||
		danmakuFor(session, resId).length > 0
	)
}

/**
 * Append a session log to a (possibly absent) seed, only allocating a new
 * array when there is actually something to append — so an untouched
 * resource keeps its seeded reference (identity is asserted in tests).
 */
function appendLog<T>(
	seed: readonly T[] | undefined,
	log: readonly T[],
): readonly T[] | undefined {
	return log.length === 0 ? seed : [...(seed ?? []), ...log]
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

function isRecordOfArrays(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false
	}
	for (const key of Object.keys(value)) {
		if (!Array.isArray((value as Record<string, unknown>)[key])) return false
	}
	return true
}

/** Collapse a raw stored value into a valid session, field by field. */
export function normalizeSession(raw: unknown): WorkbenchSession {
	const candidate =
		typeof raw === "object" && raw !== null
			? (raw as Partial<WorkbenchSession>)
			: {}
	return {
		prefs: isRecordOfRecords(candidate.prefs) ? candidate.prefs : {},
		cache: isRecordOfRecords(candidate.cache) ? candidate.cache : {},
		messages: isRecordOfArrays(candidate.messages)
			? (candidate.messages as WorkbenchSession["messages"])
			: {},
		danmaku: isRecordOfArrays(candidate.danmaku)
			? (candidate.danmaku as WorkbenchSession["danmaku"])
			: {},
	}
}
