import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("@/trpc/factory", () => ({
	trpcMutate: vi.fn(() => Promise.resolve()),
	trpcQuery: vi.fn(() => Promise.resolve([])),
}))

describe("prefSyncQueue: debounce + flush", () => {
	let trpcMutate: ReturnType<typeof vi.fn>
	let prefSync: typeof import("@/lib/prefSync").prefSync

	beforeEach(async () => {
		vi.resetModules()
		const factory = await import("@/trpc/factory")
		trpcMutate = factory.trpcMutate as unknown as ReturnType<typeof vi.fn>
		trpcMutate.mockReset()
		trpcMutate.mockResolvedValue(undefined as never)
		const factoryQuery = factory.trpcQuery as unknown as ReturnType<
			typeof vi.fn
		>
		factoryQuery.mockReset()
		factoryQuery.mockResolvedValue([])
		const libPrefSync = await import("@/lib/prefSync")
		prefSync = libPrefSync.prefSync
		const queueMod = await import("../prefSyncQueue")
		vi.useFakeTimers()
		queueMod.initPrefSyncQueue()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("collapses rapid sets within the debounce window to one mutation", () => {
		prefSync.set("theme", "light")
		prefSync.set("theme", "dark")
		prefSync.set("theme", "system")

		expect(trpcMutate).not.toHaveBeenCalled()

		vi.advanceTimersByTime(499)
		expect(trpcMutate).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		expect(trpcMutate).toHaveBeenCalledTimes(1)
		expect(trpcMutate).toHaveBeenLastCalledWith("systemPreference", "set", {
			key: "theme",
			value: "system",
		})
	})

	test("per-key debounce: different keys flush independently", () => {
		prefSync.set("theme", "dark")
		vi.advanceTimersByTime(200)
		prefSync.set("language", "en")
		vi.advanceTimersByTime(300)

		// theme has elapsed 500ms total -> flushed
		expect(trpcMutate).toHaveBeenCalledWith("systemPreference", "set", {
			key: "theme",
			value: "dark",
		})
		expect(trpcMutate).not.toHaveBeenCalledWith("systemPreference", "set", {
			key: "language",
			value: "en",
		})

		vi.advanceTimersByTime(200)
		expect(trpcMutate).toHaveBeenCalledWith("systemPreference", "set", {
			key: "language",
			value: "en",
		})
	})

	test("pagehide flushes all pending writes immediately", () => {
		prefSync.set("theme", "dark")
		prefSync.set("language", "zh")
		expect(trpcMutate).not.toHaveBeenCalled()

		window.dispatchEvent(new Event("pagehide"))

		expect(trpcMutate).toHaveBeenCalledTimes(2)
		expect(trpcMutate).toHaveBeenCalledWith("systemPreference", "set", {
			key: "theme",
			value: "dark",
		})
		expect(trpcMutate).toHaveBeenCalledWith("systemPreference", "set", {
			key: "language",
			value: "zh",
		})
	})

	test("beforeunload flushes all pending writes immediately", () => {
		prefSync.set("document.zoom", "5")

		window.dispatchEvent(new Event("beforeunload"))

		expect(trpcMutate).toHaveBeenCalledTimes(1)
		expect(trpcMutate).toHaveBeenCalledWith("systemPreference", "set", {
			key: "document.zoom",
			value: "5",
		})
	})

	test("prefSync.get reads from memory store immediately", () => {
		prefSync.set("theme", "dark")
		expect(prefSync.get("theme")).toBe("dark")
		expect(trpcMutate).not.toHaveBeenCalled()
	})
})
