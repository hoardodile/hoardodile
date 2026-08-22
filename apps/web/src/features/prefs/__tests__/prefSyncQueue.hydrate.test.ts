/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("@/trpc/factory", () => ({
	trpcMutate: vi.fn(() => Promise.resolve()),
	trpcQuery: vi.fn(() => Promise.resolve([])),
}))

vi.mock("@/lib/prefSync", () => ({
	prefSync: {
		get: vi.fn(() => undefined),
		set: vi.fn(() => {}),
		subscribe: vi.fn(() => () => {}),
	},
	notifyPrefSync: vi.fn(() => {}),
	registerPrefSyncSetHook: vi.fn(() => () => {}),
}))

vi.mock("@/lib/prefSyncStore", () => ({
	prefSyncStore: {
		get: vi.fn(() => undefined),
		set: vi.fn(() => {}),
		setSilent: vi.fn(() => {}),
		delete: vi.fn(() => {}),
		subscribe: vi.fn(() => () => {}),
		trigger: vi.fn(() => {}),
	},
}))

describe("hydrateSystemPrefs", () => {
	let trpcQuery: ReturnType<typeof vi.fn>
	let prefSyncStore: typeof import("@/lib/prefSyncStore").prefSyncStore
	let notifyPrefSync: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		vi.resetModules()
		const factory = await import("@/trpc/factory")
		trpcQuery = factory.trpcQuery as unknown as ReturnType<typeof vi.fn>
		trpcQuery.mockReset()
		trpcQuery.mockResolvedValue([])

		const storeMod = await import("@/lib/prefSyncStore")
		prefSyncStore = storeMod.prefSyncStore

		const prefMod = await import("@/lib/prefSync")
		notifyPrefSync = prefMod.notifyPrefSync as unknown as ReturnType<
			typeof vi.fn
		>
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test("fetches all prefs and bulk-loads into store", async () => {
		trpcQuery.mockResolvedValueOnce([
			{ key: "theme", value: "dark", updatedAt: 1 },
			{ key: "language", value: "en", updatedAt: 2 },
		])

		const { hydrateSystemPrefs } = await import("../prefSyncHydrator")
		await hydrateSystemPrefs()

		expect(trpcQuery).toHaveBeenCalledWith("systemPreference", "listAll")
		expect(prefSyncStore.setSilent).toHaveBeenCalledWith("theme", "dark")
		expect(prefSyncStore.setSilent).toHaveBeenCalledWith("language", "en")
		expect(notifyPrefSync).toHaveBeenCalledWith("theme")
		expect(notifyPrefSync).toHaveBeenCalledWith("language")
	})

	test("skips entries with undefined or empty value", async () => {
		trpcQuery.mockResolvedValueOnce([
			{ key: "theme", value: "", updatedAt: 1 },
			{ key: "other", value: undefined, updatedAt: 2 },
		])

		const { hydrateSystemPrefs } = await import("../prefSyncHydrator")
		await hydrateSystemPrefs()

		expect(prefSyncStore.setSilent).not.toHaveBeenCalledWith("theme", "")
		expect(prefSyncStore.setSilent).not.toHaveBeenCalledWith("other", undefined)
		expect(notifyPrefSync).not.toHaveBeenCalled()
	})

	test("hydrates every entry returned by listAll (server now excludes async keys)", async () => {
		trpcQuery.mockResolvedValueOnce([
			{ key: "theme", value: "dark", updatedAt: 1 },
			{ key: "language", value: "en", updatedAt: 2 },
		])

		const { hydrateSystemPrefs } = await import("../prefSyncHydrator")
		await hydrateSystemPrefs()

		expect(prefSyncStore.setSilent).toHaveBeenCalledWith("theme", "dark")
		expect(prefSyncStore.setSilent).toHaveBeenCalledWith("language", "en")
		expect(notifyPrefSync).toHaveBeenCalledWith("theme")
		expect(notifyPrefSync).toHaveBeenCalledWith("language")
	})

	test("no-op when local matches server", async () => {
		const storeMod = await import("@/lib/prefSyncStore")
		const realStore = storeMod.prefSyncStore
		vi.mocked(realStore.get).mockReturnValue("dark")

		trpcQuery.mockResolvedValueOnce([
			{ key: "theme", value: "dark", updatedAt: 1 },
		])

		const { hydrateSystemPrefs } = await import("../prefSyncHydrator")
		await hydrateSystemPrefs()

		expect(notifyPrefSync).not.toHaveBeenCalled()
	})

	test("hydrate failure is swallowed (no throw)", async () => {
		trpcQuery.mockRejectedValueOnce(new Error("network down"))

		const { hydrateSystemPrefs } = await import("../prefSyncHydrator")
		await expect(hydrateSystemPrefs()).resolves.toBeUndefined()
	})

	test("idempotent: second call is a no-op", async () => {
		trpcQuery.mockResolvedValueOnce([
			{ key: "theme", value: "dark", updatedAt: 1 },
		])

		const { hydrateSystemPrefs, isSystemPrefsHydrated } = await import(
			"../prefSyncHydrator"
		)
		await hydrateSystemPrefs()
		await hydrateSystemPrefs()

		expect(trpcQuery).toHaveBeenCalledTimes(1)
		expect(isSystemPrefsHydrated()).toBe(true)
	})
})
