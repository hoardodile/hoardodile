import {
	createMockDanmakuStore,
	createMockMessageStore,
} from "@hoardodile/host-web"
import { describe, expect, it, vi } from "vitest"
import { observeDanmaku, observeMessages } from "./observe.ts"

/**
 * The observe wrappers must not change store behavior — only add an
 * on-created callback. Uses the real host-web stores (node env, no DOM).
 */

describe("observeMessages", () => {
	it("fires the callback with the created row and preserves list", () => {
		const onCreated = vi.fn()
		const store = observeMessages(createMockMessageStore(), onCreated)
		const message = store.create("r-1", { body: "hi", anchor: { page: 1 } })
		expect(onCreated).toHaveBeenCalledWith("r-1", message)
		expect(store.list("r-1")).toEqual([message])
	})

	it("forwards the exact created row (the object the recorder persists)", () => {
		const onCreated = vi.fn()
		const store = observeMessages(createMockMessageStore(), onCreated)
		const message = store.create("r-1", { body: "hi", anchor: { page: 1 } })
		// The session store records this very object, so the callback must
		// receive it by identity, not a clone.
		expect(onCreated.mock.calls[0]?.[1]).toBe(message)
	})

	it("keeps the seeded rows visible through list", () => {
		const store = observeMessages(
			createMockMessageStore([
				{
					id: "m0",
					body: "seed",
					createdAt: 0,
					charIds: [],
					resIds: ["r-1"],
					likeCount: 0,
					dislikeCount: 0,
					replyCount: 0,
				},
			]),
			vi.fn(),
		)
		expect(store.list("r-1")).toHaveLength(1)
	})
})

describe("observeDanmaku", () => {
	it("fires the callback with the created row and preserves list", () => {
		const onCreated = vi.fn()
		const store = observeDanmaku(createMockDanmakuStore(), onCreated)
		const danmaku = store.create("r-1", {
			text: "yo",
			anchor: { data: {} },
			mode: "scroll",
		})
		expect(onCreated).toHaveBeenCalledWith("r-1", danmaku)
		expect(store.list("r-1")).toEqual([danmaku])
	})

	it("forwards the exact created row (the object the recorder persists)", () => {
		const onCreated = vi.fn()
		const store = observeDanmaku(createMockDanmakuStore(), onCreated)
		const danmaku = store.create("r-1", { text: "yo", anchor: { data: {} } })
		expect(onCreated.mock.calls[0]?.[1]).toBe(danmaku)
	})
})
