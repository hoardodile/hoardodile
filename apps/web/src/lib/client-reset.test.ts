import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hardResetAndReload } from "./client-reset"

describe("hardResetAndReload", () => {
	let reloadSpy: ReturnType<typeof vi.fn>
	let unregisterSpy: ReturnType<typeof vi.fn>
	let cachesDeleteSpy: ReturnType<typeof vi.fn>
	let localStorageClearSpy: ReturnType<typeof vi.fn>
	let sessionStorageClearSpy: ReturnType<typeof vi.fn>
	let deleteDatabaseSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		document.body.innerHTML = ""

		reloadSpy = vi.fn()
		unregisterSpy = vi.fn().mockResolvedValue(undefined)
		cachesDeleteSpy = vi.fn().mockResolvedValue(true)
		localStorageClearSpy = vi.fn()
		sessionStorageClearSpy = vi.fn()
		deleteDatabaseSpy = vi.fn().mockReturnValue({
			addEventListener: vi.fn((event: string, listener: () => void) => {
				if (event === "success") {
					listener()
				}
			}),
		})

		vi.stubGlobal("navigator", {
			serviceWorker: {
				getRegistrations: vi
					.fn()
					.mockResolvedValue([{ unregister: unregisterSpy }]),
			},
		})
		vi.stubGlobal("caches", {
			keys: vi.fn().mockResolvedValue(["res-v1"]),
			delete: cachesDeleteSpy,
		})
		vi.stubGlobal("localStorage", { clear: localStorageClearSpy })
		vi.stubGlobal("sessionStorage", { clear: sessionStorageClearSpy })
		vi.stubGlobal("indexedDB", {
			databases: vi
				.fn()
				.mockResolvedValue([{ name: "other-db" }, { name: undefined }]),
			deleteDatabase: deleteDatabaseSpy,
		})
		Object.defineProperty(window, "location", {
			value: { reload: reloadSpy },
			configurable: true,
			writable: true,
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("unregisters service workers, clears caches, storage, indexed db, and reloads", async () => {
		await hardResetAndReload()

		expect(unregisterSpy).toHaveBeenCalledTimes(1)
		expect(cachesDeleteSpy).toHaveBeenCalledExactlyOnceWith("res-v1")
		expect(localStorageClearSpy).toHaveBeenCalledTimes(1)
		expect(sessionStorageClearSpy).toHaveBeenCalledTimes(1)
		expect(deleteDatabaseSpy).toHaveBeenCalledWith("hoardodile-usage-queue")
		expect(deleteDatabaseSpy).toHaveBeenCalledWith("other-db")
		expect(reloadSpy).toHaveBeenCalledTimes(1)
	})

	it("still reloads when cleanup throws", async () => {
		vi.stubGlobal("caches", {
			keys: vi.fn().mockRejectedValue(new Error("boom")),
		})

		await hardResetAndReload()

		expect(reloadSpy).toHaveBeenCalledTimes(1)
	})

	it("renders a blocking reload overlay with the provided message", async () => {
		await hardResetAndReload("Reloading…")

		const overlay = document.getElementById("reload-loading-overlay")
		expect(overlay).not.toBeNull()
		expect(overlay).toHaveAttribute("role", "status")
		expect(overlay).toHaveTextContent("Reloading…")
		expect(overlay?.querySelector("[aria-hidden='true']")).not.toBeNull()
	})

	it("renders the overlay without a message when none is provided", async () => {
		await hardResetAndReload()

		const overlay = document.getElementById("reload-loading-overlay")
		expect(overlay).not.toBeNull()
		expect(overlay?.querySelector("p")).toBeNull()
	})
})
