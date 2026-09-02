import type { Danmaku, Message } from "@hoardodile/sdk-types"
import { describe, expect, it } from "vitest"
import type { ResourceContext } from "./context.ts"
import {
	cacheFor,
	cacheKey,
	danmakuFor,
	emptySession,
	hasCacheOverride,
	hasPrefOverride,
	isCacheCleared,
	isPrefsCleared,
	messagesFor,
	normalizeSession,
	prefsFor,
	recordCacheWrite,
	recordDanmaku,
	recordMessage,
	recordPrefWrite,
	seedState,
	type WorkbenchSession,
	withClearedCache,
	withClearedPrefs,
	withoutCacheOverride,
	withoutPrefOverride,
} from "./session.ts"

/**
 * The session store's hard promises: reset/clear hide the seeded
 * (read-only) prefs/cache until restored, a plugin's writes are recorded so
 * a refresh re-seeds them, and the helpers never mutate their input so
 * `App` can hold one immutable snapshot in state.
 */

const seeded = { theme: "dark" }
const seededCache = { page: "7" }

/** A minimal `ResourceContext` for the seed-join tests. */
function makeCtx(state: ResourceContext["state"]): ResourceContext {
	return {
		resId: "r-1",
		snapshot: null,
		state,
		capabilities: { preview: false, frame: false, cover: false },
	}
}

function makeMessage(body: string, id = "msg-1"): Message {
	return {
		id,
		body,
		createdAt: Date.now(),
		charIds: [],
		resIds: ["r-1"],
		likeCount: 0,
		dislikeCount: 0,
		replyCount: 0,
		anchor: { resId: "r-1", data: { page: 2 } },
	}
}

function makeDanmaku(text: string, id = "dm-1"): Danmaku {
	return {
		id,
		anchor: { resId: "r-1", data: {} },
		text,
		color: "#fff",
		mode: "scroll",
		createdAt: Date.now(),
	}
}

describe("empty session", () => {
	it("has empty maps for every store", () => {
		const s = emptySession()
		expect(s.prefs).toEqual({})
		expect(s.cache).toEqual({})
		expect(s.messages).toEqual({})
		expect(s.danmaku).toEqual({})
	})
})

describe("seed resolution", () => {
	it("returns the seeded value when no override exists", () => {
		expect(prefsFor(emptySession(), "plugin-a", seeded)).toBe(seeded)
		expect(cacheFor(emptySession(), "plugin-a", "r-1", seededCache)).toBe(
			seededCache,
		)
	})

	it("reset hides the seeded value with an empty map", () => {
		const cleared = withClearedPrefs(emptySession(), "plugin-a")
		expect(hasPrefOverride(cleared, "plugin-a")).toBe(true)
		expect(prefsFor(cleared, "plugin-a", seeded)).toEqual({})
	})

	it("restore brings the seeded value back", () => {
		const cleared = withClearedPrefs(emptySession(), "plugin-a")
		expect(
			prefsFor(withoutPrefOverride(cleared, "plugin-a"), "plugin-a", seeded),
		).toBe(seeded)
		expect(
			hasPrefOverride(withoutPrefOverride(cleared, "plugin-a"), "plugin-a"),
		).toBe(false)
	})
})

describe("recorded writes", () => {
	it("records a pref write over the library seed", () => {
		const next = recordPrefWrite(
			emptySession(),
			"plugin-a",
			seeded,
			"font",
			"serif",
		)
		expect(prefsFor(next, "plugin-a", seeded)).toEqual({
			theme: "dark",
			font: "serif",
		})
	})

	it("accumulates successive pref writes", () => {
		const first = recordPrefWrite(
			emptySession(),
			"plugin-a",
			seeded,
			"font",
			"serif",
		)
		const second = recordPrefWrite(first, "plugin-a", seeded, "size", "12")
		expect(prefsFor(second, "plugin-a", seeded)).toEqual({
			theme: "dark",
			font: "serif",
			size: "12",
		})
	})

	it("a write after reset uses the cleared baseline, not the seed", () => {
		const cleared = withClearedPrefs(emptySession(), "plugin-a")
		const next = recordPrefWrite(cleared, "plugin-a", seeded, "font", "serif")
		expect(prefsFor(next, "plugin-a", seeded)).toEqual({ font: "serif" })
	})

	it("scopes cache writes by plugin and resource", () => {
		const next = recordCacheWrite(
			emptySession(),
			"plugin-a",
			"r-1",
			seededCache,
			"scroll",
			"42",
		)
		expect(cacheFor(next, "plugin-a", "r-1", seededCache)).toEqual({
			page: "7",
			scroll: "42",
		})
		expect(cacheFor(next, "plugin-a", "r-2", seededCache)).toBe(seededCache)
		expect(cacheFor(next, "plugin-b", "r-1", seededCache)).toBe(seededCache)
	})

	it("does not mutate the input snapshot", () => {
		const original = emptySession()
		recordPrefWrite(original, "plugin-a", seeded, "font", "serif")
		recordCacheWrite(original, "plugin-a", "r-1", seededCache, "k", "v")
		expect(original).toEqual(emptySession())
	})
})

describe("message and danmaku logs", () => {
	it("records created messages per resource", () => {
		const message = makeMessage("hello")
		const next = recordMessage(emptySession(), "r-1", message)
		expect(messagesFor(next, "r-1")).toEqual([message])
		expect(messagesFor(next, "r-2")).toEqual([])
	})

	it("records created danmaku per resource", () => {
		const danmaku = makeDanmaku("hi")
		const next = recordDanmaku(emptySession(), "r-1", danmaku)
		expect(danmakuFor(next, "r-1")).toEqual([danmaku])
	})

	it("appends rather than replaces on successive creates", () => {
		const first = recordMessage(emptySession(), "r-1", makeMessage("a", "m1"))
		const second = recordMessage(first, "r-1", makeMessage("b", "m2"))
		expect(messagesFor(second, "r-1").map((m) => m.id)).toEqual(["m1", "m2"])
	})

	it("does not mutate the input snapshot", () => {
		const original = emptySession()
		recordMessage(original, "r-1", makeMessage("a"))
		recordDanmaku(original, "r-1", makeDanmaku("b"))
		expect(original).toEqual(emptySession())
	})
})

describe("cache scoping", () => {
	it("reset and restore round-trip per resource", () => {
		const cleared = withClearedCache(emptySession(), "plugin-a", "r-1")
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
		const original = emptySession()
		withClearedPrefs(original, "plugin-a")
		withClearedCache(original, "plugin-a", "r-1")
		withoutPrefOverride(original, "plugin-a")
		withoutCacheOverride(original, "plugin-a", "r-1")
		expect(original).toEqual(emptySession())
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
		const out = seedState(emptySession(), "plugin-a", "r-1", input)
		expect(out.state?.prefs).toBe(seeded)
		expect(out.state?.cache).toBe(seededCache)
		expect(out.state?.name).toBe("Sunset")
		expect(out.resId).toBe("r-1")
		expect(out.snapshot).toBe(null)
		expect(out.capabilities).toEqual({
			preview: false,
			frame: false,
			cover: false,
		})
	})

	it("an empty override shadows the non-empty seeded value", () => {
		const overridden = withClearedPrefs(
			withClearedCache(emptySession(), "plugin-a", "r-1"),
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

	it("appends the recorded message/danmaku logs to the seeded rows", () => {
		const message = makeMessage("hello")
		const danmaku = makeDanmaku("hi")
		const session = recordDanmaku(
			recordMessage(emptySession(), "r-1", message),
			"r-1",
			danmaku,
		)
		const out = seedState(
			session,
			"plugin-a",
			"r-1",
			makeCtx({ messages: [makeMessage("seed", "m0")], danmaku: [] }),
		)
		expect(out.state?.messages?.map((m) => m.id)).toEqual(["m0", "msg-1"])
		expect(out.state?.danmaku?.map((d) => d.id)).toEqual(["dm-1"])
	})

	it("keeps the seeded message reference when nothing was recorded", () => {
		const messages = [makeMessage("seed", "m0")]
		const input = makeCtx({ messages })
		const out = seedState(emptySession(), "plugin-a", "r-1", input)
		expect(out.state?.messages).toBe(messages)
		expect(out.state?.danmaku).toBe(input.state?.danmaku)
	})

	it("leaves the name and non-state fields untouched", () => {
		const state: ResourceContext["state"] = {
			name: "n",
			messages: [],
			danmaku: [],
		}
		const out = seedState(
			withClearedPrefs(emptySession(), "plugin-a"),
			"plugin-a",
			"r-1",
			makeCtx(state),
		)
		expect(out.state?.name).toBe("n")
		expect(out.resId).toBe("r-1")
	})

	it("returns the same context when there is no seeded state", () => {
		const input = makeCtx(null)
		expect(seedState(emptySession(), "plugin-a", "r-1", input)).toBe(input)
	})

	it("synthesizes a state from the session when the dev server has no DB state", () => {
		// The `--data`/`--resource-dir` shape yields `ctx.state === null`;
		// a recorded write must still re-seed on refresh.
		const session = recordPrefWrite(
			recordCacheWrite(emptySession(), "plugin-a", "r-1", {}, "scroll", "42"),
			"plugin-a",
			{},
			"font",
			"serif",
		)
		const out = seedState(session, "plugin-a", "r-1", makeCtx(null))
		expect(out.state).not.toBeNull()
		expect(out.state?.prefs).toEqual({ font: "serif" })
		expect(out.state?.cache).toEqual({ scroll: "42" })
	})

	it("synthesizes messages/danmaku from the session log when there is no DB state", () => {
		const session = recordDanmaku(
			recordMessage(emptySession(), "r-1", makeMessage("hi")),
			"r-1",
			makeDanmaku("yo"),
		)
		const out = seedState(session, "plugin-a", "r-1", makeCtx(null))
		expect(out.state?.messages?.map((m) => m.id)).toEqual(["msg-1"])
		expect(out.state?.danmaku?.map((d) => d.id)).toEqual(["dm-1"])
	})

	it("never mutates the input context", () => {
		const input = makeCtx({ prefs: seeded, cache: seededCache })
		seedState(
			withClearedPrefs(
				withClearedCache(emptySession(), "plugin-a", "r-1"),
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
		const cleared = withClearedPrefs(emptySession(), "plugin-a")
		expect(hasPrefOverride(cleared, "plugin-b")).toBe(false)
		expect(prefsFor(cleared, "plugin-b", seeded)).toBe(seeded)
	})

	it("a cache override never leaks across plugins or resources", () => {
		const cleared = withClearedCache(emptySession(), "plugin-a", "r-1")
		expect(cacheFor(cleared, "plugin-b", "r-1", seededCache)).toBe(seededCache)
		expect(cacheFor(cleared, "plugin-a", "r-2", seededCache)).toBe(seededCache)
	})

	it("has* flags are false on an empty session", () => {
		expect(hasPrefOverride(emptySession(), "plugin-a")).toBe(false)
		expect(hasCacheOverride(emptySession(), "plugin-a", "r-1")).toBe(false)
	})
})

describe("cleared flags", () => {
	it("distinguishes a reset (empty map) from a recorded write", () => {
		const reset = withClearedPrefs(emptySession(), "plugin-a")
		expect(isPrefsCleared(reset, "plugin-a")).toBe(true)
		expect(isPrefsCleared(emptySession(), "plugin-a")).toBe(false)

		const written = recordPrefWrite(
			emptySession(),
			"plugin-a",
			seeded,
			"k",
			"v",
		)
		expect(isPrefsCleared(written, "plugin-a")).toBe(false)
		expect(hasPrefOverride(written, "plugin-a")).toBe(true)
	})

	it("flags an empty cache reset, not a write", () => {
		const reset = withClearedCache(emptySession(), "plugin-a", "r-1")
		expect(isCacheCleared(reset, "plugin-a", "r-1")).toBe(true)
		expect(isCacheCleared(emptySession(), "plugin-a", "r-1")).toBe(false)

		const written = recordCacheWrite(
			emptySession(),
			"plugin-a",
			"r-1",
			seededCache,
			"k",
			"v",
		)
		expect(isCacheCleared(written, "plugin-a", "r-1")).toBe(false)
		expect(hasCacheOverride(written, "plugin-a", "r-1")).toBe(true)
	})
})

describe("normalizeSession (stored shape)", () => {
	it("collapses non-object input to an empty session", () => {
		expect(normalizeSession(null)).toEqual(emptySession())
		expect(normalizeSession(42)).toEqual(emptySession())
	})

	it("rejects malformed map shapes per field", () => {
		expect(
			normalizeSession({ prefs: "nope", cache: 42, messages: [], danmaku: {} }),
		).toEqual({ prefs: {}, cache: {}, messages: {}, danmaku: {} })
	})

	it("preserves real maps and arrays", () => {
		const raw: unknown = {
			prefs: { "plugin-a": { theme: "dark" } },
			cache: { [cacheKey("plugin-a", "r-1")]: { scroll: "42" } },
			messages: { "r-1": [makeMessage("hi")] },
			danmaku: { "r-1": [makeDanmaku("yo")] },
		}
		const s = normalizeSession(raw)
		expect(prefsFor(s, "plugin-a", seeded)).toEqual({ theme: "dark" })
		expect(cacheFor(s, "plugin-a", "r-1", seededCache)).toEqual({
			scroll: "42",
		})
		expect(messagesFor(s, "r-1")[0]?.body).toBe("hi")
		expect(danmakuFor(s, "r-1")[0]?.text).toBe("yo")
	})
})

describe("round-trip of a populated session", () => {
	it("preserves real entries, not just empty maps", () => {
		const session: WorkbenchSession = {
			prefs: { "plugin-a": { theme: "dark" } },
			cache: { [cacheKey("plugin-a", "r-1")]: { scroll: "42" } },
			messages: {},
			danmaku: {},
		}
		expect(prefsFor(session, "plugin-a", seeded)).toEqual({ theme: "dark" })
		expect(cacheFor(session, "plugin-a", "r-1", seededCache)).toEqual({
			scroll: "42",
		})
	})
})
