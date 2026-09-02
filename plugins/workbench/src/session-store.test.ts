import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	emptySession,
	normalizeSession,
	recordPrefWrite,
	type WorkbenchSession,
} from "./session.ts"
import { createSessionStore } from "./session-store.ts"

/**
 * IndexedDB persistence tests. `fake-indexeddb/auto` provides a working
 * IndexedDB in the node vitest env, so `idb`'s `openDB` runs against a real
 * (in-memory) database. `load` has to be async, and `save` is coalesced and
 * fire-and-forget — the store exposes `flush` so a test can await the write.
 */

const seeded = { theme: "dark" }

class MemoryStorage implements Storage {
	private readonly map = new Map<string, string>()

	get length(): number {
		return this.map.size
	}

	clear(): void {
		this.map.clear()
	}

	getItem(key: string): string | null {
		return this.map.get(key) ?? null
	}

	key(index: number): string | null {
		return [...this.map.keys()][index] ?? null
	}

	removeItem(key: string): void {
		this.map.delete(key)
	}

	setItem(key: string, value: string): void {
		this.map.set(key, value)
	}
}

let storage: MemoryStorage
const LEGACY_KEY = "hoardodile.workbench.plugin-state"

beforeEach(async () => {
	storage = new MemoryStorage()
	globalThis.localStorage = storage as unknown as Storage
	// The fake IndexedDB persists across tests in a file; start each one
	// from a clean store so an earlier test's record never leaks in.
	const { openDB } = await import("idb")
	const db = await openDB("hoardodile-workbench", 1, {
		upgrade(database) {
			if (!database.objectStoreNames.contains("session")) {
				database.createObjectStore("session", { keyPath: "key" })
			}
		},
	})
	await db.clear("session")
})

afterEach(() => {
	// @ts-expect-error — node has no localStorage; the fake is test-only.
	delete globalThis.localStorage
	vi.unstubAllGlobals()
})

describe("createSessionStore", () => {
	it("returns an empty session when nothing is stored", async () => {
		const store = createSessionStore()
		expect(await store.load()).toEqual(emptySession())
	})

	it("round-trips a saved session through IndexedDB", async () => {
		const store = createSessionStore()
		const session = recordPrefWrite(
			emptySession(),
			"plugin-a",
			seeded,
			"font",
			"serif",
		)
		store.save(session)
		await store.flush()
		expect(await store.load()).toEqual(session)
	})

	it("coalesces rapid saves to the latest snapshot (last-write-wins)", async () => {
		const store = createSessionStore()
		const a = recordPrefWrite(
			emptySession(),
			"plugin-a",
			seeded,
			"font",
			"serif",
		)
		const b = recordPrefWrite(a, "plugin-a", seeded, "size", "12")
		const c = recordPrefWrite(b, "plugin-a", seeded, "width", "800")
		store.save(a)
		store.save(b)
		store.save(c)
		await store.flush()
		expect(await store.load()).toEqual(c)
	})

	it("migrates the legacy localStorage override on first load", async () => {
		storage.setItem(
			LEGACY_KEY,
			JSON.stringify({ prefs: { p: { a: "1" } }, cache: {} }),
		)
		const store = createSessionStore()
		const loaded = await store.load()
		expect(loaded.prefs.p).toEqual({ a: "1" })
		// The legacy key is consumed once and the value lives on in IndexedDB.
		expect(storage.getItem(LEGACY_KEY)).toBeNull()
		expect(await store.load()).toEqual(loaded)
	})

	it("normalizes a stored session field by field", async () => {
		const store = createSessionStore()
		// Write a malformed-shaped record straight into the store, bypassing
		// the save path (which stores the snapshot as-is).
		const { openDB } = await import("idb")
		const db = await openDB("hoardodile-workbench", 1, {
			upgrade(database) {
				if (!database.objectStoreNames.contains("session")) {
					database.createObjectStore("session", { keyPath: "key" })
				}
			},
		})
		await db.put("session", { key: "main", session: { prefs: 42, cache: "x" } })
		expect(await store.load()).toEqual({
			prefs: {},
			cache: {},
			messages: {},
			danmaku: {},
		})
	})

	it("degrades to an empty session when IndexedDB is unavailable", async () => {
		vi.stubGlobal("indexedDB", undefined)
		const store = createSessionStore()
		expect(await store.load()).toEqual(emptySession())
		// save must not throw even when the database cannot open.
		store.save(recordPrefWrite(emptySession(), "plugin-a", seeded, "k", "v"))
		await store.flush()
		expect(await store.load()).toEqual(emptySession())
	})

	it("saves and loads a session carrying messages and danmaku", async () => {
		const store = createSessionStore()
		const session: WorkbenchSession = {
			prefs: {},
			cache: {},
			messages: { "r-1": [{ id: "m1", body: "hi" } as never] },
			danmaku: {},
		}
		store.save(session)
		await store.flush()
		const loaded = await store.load()
		expect(loaded.messages["r-1"]?.[0]?.body).toBe("hi")
		// normalizeSession keeps valid arrays.
		expect(normalizeSession(loaded).messages["r-1"]?.[0]?.body).toBe("hi")
	})
})
