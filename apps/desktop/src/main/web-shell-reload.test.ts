import { describe, expect, it, vi } from "vitest"
import type { StaleWebShellSession } from "./shell-cache"
import { type ReloadableWindow, reloadAppWindow } from "./web-shell-reload"

const APP_URL = "http://127.0.0.1:4321"

function fakeSession(): StaleWebShellSession {
	return {
		clearCache: vi.fn().mockResolvedValue(undefined),
		clearStorageData: vi.fn().mockResolvedValue(undefined),
	}
}

function fakeWindow(currentUrl: string): {
	readonly win: ReloadableWindow
	readonly loadURL: ReturnType<typeof vi.fn>
	readonly reloadIgnoringCache: ReturnType<typeof vi.fn>
	/** Present only so a revert to plain `reload()` is observable. */
	readonly reload: ReturnType<typeof vi.fn>
} {
	const loadURL = vi.fn().mockResolvedValue(undefined)
	const reloadIgnoringCache = vi.fn()
	const reload = vi.fn()
	return {
		win: {
			webContents: {
				getURL: () => currentUrl,
				loadURL,
				reloadIgnoringCache,
				reload,
			},
		},
		loadURL,
		reloadIgnoringCache,
		reload,
	}
}

describe("reloadAppWindow", () => {
	it("drops the web shell caches before reloading on the same URL", async () => {
		const session = fakeSession()
		const { win, loadURL, reloadIgnoringCache, reload } = fakeWindow(APP_URL)
		const calls: string[] = []
		vi.mocked(session.clearCache).mockImplementation(async () => {
			calls.push("clearCache")
		})
		reloadIgnoringCache.mockImplementation(() => {
			calls.push("reloadIgnoringCache")
		})

		await reloadAppWindow({ win, sidecarUrl: APP_URL, session })

		// The pack swapped the build under an unchanged origin: the cache-like
		// storages go first, and the load must not reuse the HTTP cache (a
		// plain `reload()` would replay the previous shell).
		expect(session.clearCache).toHaveBeenCalledTimes(1)
		expect(session.clearStorageData).toHaveBeenCalledWith({
			storages: ["cachestorage", "serviceworkers"],
		})
		expect(reloadIgnoringCache).toHaveBeenCalledTimes(1)
		expect(reload).not.toHaveBeenCalled()
		expect(calls).toEqual(["clearCache", "reloadIgnoringCache"])
		expect(loadURL).not.toHaveBeenCalled()
	})

	it("never signs the user out while clearing", async () => {
		const session = fakeSession()
		const { win } = fakeWindow(APP_URL)

		await reloadAppWindow({ win, sidecarUrl: APP_URL, session })

		const storages =
			vi.mocked(session.clearStorageData).mock.calls[0]?.[0]?.storages ?? []
		expect(storages).not.toContain("cookies")
		expect(storages).not.toContain("localstorage")
		expect(storages).not.toContain("indexdb")
	})

	it("follows a moved sidecar port and carries the SPA route over", async () => {
		const session = fakeSession()
		const { win, loadURL, reloadIgnoringCache } = fakeWindow(
			`${APP_URL}/resources/res-1`,
		)

		await reloadAppWindow({
			win,
			sidecarUrl: "http://127.0.0.1:4322",
			session,
		})

		// The cookie is host-scoped, so a port change keeps the user signed
		// in — but a bare reload would retry the dead URL.
		expect(loadURL).toHaveBeenCalledWith(
			"http://127.0.0.1:4322/resources/res-1",
		)
		expect(reloadIgnoringCache).not.toHaveBeenCalled()
		// A recreated origin still gets the stale-shell caches dropped.
		expect(session.clearCache).toHaveBeenCalledTimes(1)
	})

	it("reloads in place when the sidecar URL is unknown", async () => {
		const session = fakeSession()
		const { win, loadURL, reloadIgnoringCache, reload } = fakeWindow(APP_URL)

		await reloadAppWindow({ win, sidecarUrl: undefined, session })

		expect(reloadIgnoringCache).toHaveBeenCalledTimes(1)
		expect(reload).not.toHaveBeenCalled()
		expect(loadURL).not.toHaveBeenCalled()
	})
})
