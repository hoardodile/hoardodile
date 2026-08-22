/**
 * @vitest-environment node
 */

import { describe, expect, test, vi } from "vitest"
import {
	notifyPrefSync,
	prefSync,
	registerPrefSyncSetHook,
} from "@/lib/prefSync"

describe("prefSync cross-tab + subscriber semantics", () => {
	test("subscribe receives notify on same-tab set", () => {
		const cb = vi.fn()
		const unsubscribe = prefSync.subscribe("theme", cb)
		prefSync.set("theme", "dark")
		expect(cb).toHaveBeenCalledTimes(1)
		expect(prefSync.get("theme")).toBe("dark")
		unsubscribe()
	})

	test("subscribe is unsubscribed cleanly", () => {
		const cb = vi.fn()
		const unsubscribe = prefSync.subscribe("theme", cb)
		unsubscribe()
		prefSync.set("theme", "light")
		expect(cb).not.toHaveBeenCalled()
	})

	test("notifyPrefSync fires subscribers without mutating value", () => {
		const cb = vi.fn()
		const unsubscribe = prefSync.subscribe("theme", cb)
		const previous = prefSync.get("theme")
		notifyPrefSync("theme")
		expect(cb).toHaveBeenCalledTimes(1)
		// notifyPrefSync does not change the stored value.
		expect(prefSync.get("theme")).toBe(previous)
		unsubscribe()
	})

	test("registerPrefSyncSetHook forwards same-tab sets to external listener", () => {
		const hook = vi.fn()
		const unregister = registerPrefSyncSetHook(hook)
		prefSync.set("language", "en")
		expect(hook).toHaveBeenCalledWith("language", "en")
		unregister()
		prefSync.set("language", "zh")
		expect(hook).toHaveBeenCalledTimes(1)
	})
})
