import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ResourceContext } from "./context.ts"
import {
	cacheFor,
	cacheKey,
	emptyOverrides,
	hasCacheOverride,
	hasPrefOverride,
	loadPluginStateOverrides,
	PLUGIN_STATE_STORAGE_KEY,
	type PluginStateOverrides,
	prefsFor,
	savePluginStateOverrides,
	seedState,
	withClearedCache,
	withClearedPrefs,
	withoutCacheOverride,
	withoutPrefOverride,
} from "./plugin-state.ts"

/**
 * The override store's two hard promises: reset/clear hide the seeded
 * (read-only) prefs/cache until restored, and the helpers never mutate
 * their input so `App` can hold one immutable snapshot in state.
 */

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

beforeEach(() => {
	storage = new MemoryStorage()
	globalThis.localStorage = storage as unknown as Storage
})

afterEach(() => {
	// @ts-expect-error — node has no localStorage; the fake is test-only.
	delete globalThis.localStorage
})

const seeded = { theme: "dark" }
const seededCache = { page: "7" }

/** A minimal `ResourceContext` for the seed-join tests. */
function makeCtx(state: ResourceContext["state"]): ResourceContext {
	return {
		resId: "r-1",
		snapshot: null,
		state,
		capabilities: { preview: false, frame: false },
	}
}

describe("loading and saving", () => {
	it("round-trips an override", () => {
		const override: PluginStateOverrides = {
			prefs: { "plugin-a": {} },
			cache: { [cacheKey("plugin-a", "r-1")]: {} },
		}
		savePluginStateOverrides(override)
		expect(loadPluginStateOverrides()).toEqual(override)
	})

	it("falls back to empty on an absent value", () => {
		expect(loadPluginStateOverrides()).toEqual(emptyOverrides())
	})

	it("falls back to empty on corrupt JSON", () => {
		localStorage.setItem(PLUGIN_STATE_STORAGE_KEY, "{not json")
		expect(loadPluginStateOverrides()).toEqual(emptyOverrides())
	})

	it("rejects malformed map shapes per field", () => {
		localStorage.setItem(
			PLUGIN_STATE_STORAGE_KEY,
			JSON.stringify({ prefs: "nope", cache: 42 }),
		)
		expect(loadPluginStateOverrides()).toEqual(emptyOverrides())
	})
})

describe("seed resolution", () => {
	it("returns the seeded value when no override exists", () => {
		expect(prefsFor(emptyOverrides(), "plugin-a", seeded)).toBe(seeded)
		expect(cacheFor(emptyOverrides(), "plugin-a", "r-1", seededCache)).toBe(
			seededCache,
		)
	})

	it("reset hides the seeded value with an empty map", () => {
		const cleared = withClearedPrefs(emptyOverrides(), "plugin-a")
		expect(hasPrefOverride(cleared, "plugin-a")).toBe(true)
		expect(prefsFor(cleared, "plugin-a", seeded)).toEqual({})
	})

	it("restore brings the seeded value back", () => {
		const cleared = withClearedPrefs(emptyOverrides(), "plugin-a")
		expect(
			prefsFor(withoutPrefOverride(cleared, "plugin-a"), "plugin-a", seeded),
		).toBe(seeded)
		expect(
			hasPrefOverride(withoutPrefOverride(cleared, "plugin-a"), "plugin-a"),
		).toBe(false)
	})
})

describe("cache scoping", () => {
	it("reset and restore round-trip per resource", () => {
		const cleared = withClearedCache(emptyOverrides(), "plugin-a", "r-1")
		expect(hasCacheOverride(cleared, "plugin-a", "r-1")).toBe(true)
		expect(cacheFor(cleared, "plugin-a", "r-1", seededCache)).toEqual({})
		expect(cacheFor(cleared, "plugin-a", "r-2", seededCache)).toBe(seededCache)
		expect(
			cacheFor(
				withoutCacheOverride(cleared, "plugin-a", "r-1"),
				"plugin-a",
				"r-1",
				seededCache,
			),
		).toBe(seededCache)
	})

	it("keys never collide across resources", () => {
		expect(cacheKey("plugin-a", "r-1")).not.toBe(cacheKey("plugin-a", "r-2"))
		expect(cacheKey("plugin-a", "r-1")).not.toBe(cacheKey("plugin-b", "r-1"))
	})
})

describe("immutability", () => {
	it("the helpers never mutate their input snapshot", () => {
		const original = emptyOverrides()
		withClearedPrefs(original, "plugin-a")
		withClearedCache(original, "plugin-a", "r-1")
		withoutPrefOverride(original, "plugin-a")
		withoutCacheOverride(original, "plugin-a", "r-1")
		expect(original).toEqual(emptyOverrides())
	})
})

describe("seedState (context join)", () => {
	it("passes the seeded prefs/cache through when no override exists", () => {
		const input = makeCtx({
			name: "Sunset",
			messages: [],
			prefs: seeded,
			cache: seededCache,
		})
		const out = seedState(emptyOverrides(), "plugin-a", "r-1", input)
		expect(out.state?.prefs).toBe(seeded)
		expect(out.state?.cache).toBe(seededCache)
		expect(out.state?.name).toBe("Sunset")
		expect(out.resId).toBe("r-1")
		expect(out.snapshot).toBe(null)
		expect(out.capabilities).toEqual({ preview: false, frame: false })
	})

	it("an empty override shadows the non-empty seeded value", () => {
		const overridden = withClearedPrefs(
			withClearedCache(emptyOverrides(), "plugin-a", "r-1"),
			"plugin-a",
		)
		const out = seedState(
			overridden,
			"plugin-a",
			"r-1",
			makeCtx({ prefs: seeded, cache: seededCache }),
		)
		expect(out.state?.prefs).toEqual({})
		expect(out.state?.cache).toEqual({})
	})

	it("leaves messages, danmaku and name untouched", () => {
		const state: ResourceContext["state"] = {
			name: "n",
			messages: [],
			danmaku: [],
		}
		const out = seedState(
			withClearedPrefs(emptyOverrides(), "plugin-a"),
			"plugin-a",
			"r-1",
			makeCtx(state),
		)
		expect(out.state?.name).toBe("n")
		expect(out.state?.messages).toBe(state.messages)
		expect(out.state?.danmaku).toBe(state.danmaku)
	})

	it("returns the same context when there is no seeded state", () => {
		const input = makeCtx(null)
		expect(seedState(emptyOverrides(), "plugin-a", "r-1", input)).toBe(input)
	})

	it("never mutates the input context", () => {
		const input = makeCtx({ prefs: seeded, cache: seededCache })
		seedState(
			withClearedPrefs(
				withClearedCache(emptyOverrides(), "plugin-a", "r-1"),
				"plugin-a",
			),
			"plugin-a",
			"r-1",
			input,
		)
		expect(input.state?.prefs).toBe(seeded)
		expect(input.state?.cache).toBe(seededCache)
	})
})

describe("isolation", () => {
	it("a prefs override never leaks to another plugin", () => {
		const cleared = withClearedPrefs(emptyOverrides(), "plugin-a")
		expect(hasPrefOverride(cleared, "plugin-b")).toBe(false)
		expect(prefsFor(cleared, "plugin-b", seeded)).toBe(seeded)
	})

	it("a cache override never leaks across plugins or resources", () => {
		const cleared = withClearedCache(emptyOverrides(), "plugin-a", "r-1")
		expect(cacheFor(cleared, "plugin-b", "r-1", seededCache)).toBe(seededCache)
		expect(cacheFor(cleared, "plugin-a", "r-2", seededCache)).toBe(seededCache)
	})

	it("has* flags are false on an empty override", () => {
		expect(hasPrefOverride(emptyOverrides(), "plugin-a")).toBe(false)
		expect(hasCacheOverride(emptyOverrides(), "plugin-a", "r-1")).toBe(false)
	})
})

describe("round-trip of a populated override", () => {
	it("preserves real entries, not just empty maps", () => {
		savePluginStateOverrides({
			prefs: { "plugin-a": { theme: "dark" } },
			cache: { [cacheKey("plugin-a", "r-1")]: { scroll: "42" } },
		})
		const loaded = loadPluginStateOverrides()
		expect(prefsFor(loaded, "plugin-a", seeded)).toEqual({ theme: "dark" })
		expect(cacheFor(loaded, "plugin-a", "r-1", seededCache)).toEqual({
			scroll: "42",
		})
	})
})
