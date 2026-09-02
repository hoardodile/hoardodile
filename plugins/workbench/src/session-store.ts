import { type DBSchema, type IDBPDatabase, openDB } from "idb"
import {
	emptySession,
	normalizeSession,
	type WorkbenchSession,
} from "./session.ts"

/**
 * IndexedDB-backed persistence for the workbench session. The plugin's
 * prefs/cache/messages/danmaku are recorded against the browser's IndexedDB
 * (not localStorage — the user chose that), so the dev session survives a
 * page refresh. The whole session is one structured-clone record, which is
 * simplest for a single-plugin dev tool and keeps load/save atomic.
 *
 * Two properties the workbench needs:
 *
 * 1. **Graceful degradation.** IndexedDB may be unavailable (private
 *    browsing, `indexedDB === undefined`). `load` then returns an empty
 *    session and `save` is a no-op, so the page still works in memory —
 *    mirroring how `config.ts` treats an unavailable storage.
 * 2. **Write coalescing.** A plugin burst of `setPref`/`setCache`/`create*`
 *    calls must not race or spam transactions: `save` keeps the latest
 *    snapshot and writes it at most once per in-flight transaction
 *    (last-write-wins).
 *
 * A database upgrade creates a single object store keyed by `key`, and the
 * record value is `{ key: "main", session }`. A legacy localStorage override
 * (`hoardodile.workbench.plugin-state`) is migrated once on first load and
 * then the key is removed.
 */

const DB_NAME = "hoardodile-workbench"
const DB_VERSION = 1
const STORE_NAME = "session"
const RECORD_KEY = "main"

/** Legacy localStorage override key migrated to IndexedDB on first load. */
const LEGACY_STORAGE_KEY = "hoardodile.workbench.plugin-state"

type SessionRecord = {
	readonly key: string
	readonly session: WorkbenchSession
}

type SessionDB = DBSchema & {
	session: { readonly key: string; readonly value: SessionRecord }
}

export type SessionStore = {
	/** Read the persisted session; absent/unavailable yields an empty session. */
	readonly load: () => Promise<WorkbenchSession>
	/** Record a session snapshot (coalesced; last-write-wins, fire-and-forget). */
	readonly save: (session: WorkbenchSession) => void
	/** Resolve when every queued snapshot has been written (tests only). */
	readonly flush: () => Promise<void>
}

export function createSessionStore(): SessionStore {
	let dbPromise: Promise<IDBPDatabase<SessionDB>> | null = null
	let inFlight: Promise<void> | null = null
	let pending: WorkbenchSession | null = null

	function db(): Promise<IDBPDatabase<SessionDB>> {
		if (dbPromise === null) {
			dbPromise = openDB<SessionDB>(DB_NAME, DB_VERSION, {
				upgrade(database) {
					if (!database.objectStoreNames.contains(STORE_NAME)) {
						database.createObjectStore(STORE_NAME, { keyPath: "key" })
					}
				},
			}).catch((err: unknown) => {
				// Let a later load/save try again, rather than caching a
				// rejection for the rest of the session.
				dbPromise = null
				throw err
			})
		}
		return dbPromise
	}

	async function putSession(session: WorkbenchSession): Promise<void> {
		const database = await db()
		const tx = database.transaction(STORE_NAME, "readwrite")
		await tx.store.put({ key: RECORD_KEY, session })
		await tx.done
	}

	return {
		async load() {
			try {
				const record = await readRecord()
				if (record !== undefined) return normalizeSession(record.session)
			} catch {
				// IndexedDB unavailable — fall through to the legacy key.
			}
			const legacy = readLegacy()
			if (legacy !== null) {
				const migrated = normalizeSession(legacy)
				// Best-effort write so the migrated value survives even if a
				// later load misses the (now-removed) legacy key.
				try {
					await putSession(migrated)
				} catch {
					// Storage unavailable: the session still works in memory.
				}
				removeLegacy()
				return migrated
			}
			return emptySession()
		},
		save(session) {
			pending = session
			if (inFlight !== null) return
			inFlight = (async () => {
				while (pending !== null) {
					const snapshot = pending
					pending = null
					try {
						await putSession(snapshot)
					} catch {
						// Storage unavailable — drop the queued snapshot; the
						// in-memory session state stays authoritative.
					}
				}
				inFlight = null
			})()
		},
		flush() {
			// `save` starts the loop synchronously, so once a snapshot is
			// queued `inFlight` is either the running loop (which drains
			// every later snapshot) or already null (everything done).
			return inFlight ?? Promise.resolve()
		},
	}

	async function readRecord(): Promise<SessionRecord | undefined> {
		const database = await db()
		const tx = database.transaction(STORE_NAME, "readonly")
		const record = await tx.store.get(RECORD_KEY)
		await tx.done
		return record
	}

	function readLegacy(): unknown {
		try {
			const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
			return raw === null ? null : JSON.parse(raw)
		} catch {
			return null
		}
	}

	function removeLegacy(): void {
		try {
			localStorage.removeItem(LEGACY_STORAGE_KEY)
		} catch {
			// Private mode: nothing to remove.
		}
	}
}
