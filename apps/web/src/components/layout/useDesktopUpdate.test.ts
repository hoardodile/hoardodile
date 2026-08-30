/**
 * @vitest-environment jsdom
 */

import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { HoardodileDesktopBridge } from "@/lib/desktop"
import { prefKeys } from "@/lib/keys"
import { computeUpdateAvailable, useUpdateAvailable } from "./useDesktopUpdate"

const available = (version: string): DesktopUpdateState => ({
	status: "available",
	version,
})

describe("computeUpdateAvailable", () => {
	it("is unavailable when there is no update state at all", () => {
		expect(computeUpdateAvailable(undefined, "0.1.3", "")).toEqual({
			version: undefined,
			available: false,
		})
	})

	it("is available for a newer version the user has never seen", () => {
		expect(computeUpdateAvailable(available("0.1.4"), "0.1.3", "")).toEqual({
			version: "0.1.4",
			available: true,
		})
	})

	it("treats an empty lastSeen as the baseline version", () => {
		expect(
			computeUpdateAvailable(available("0.1.4"), "0.1.3", "0.0.0").available,
		).toBe(true)
	})

	it("is unavailable once the version has been seen", () => {
		// The About page marks the version seen; the dot must not re-appear.
		expect(
			computeUpdateAvailable(available("0.1.4"), "0.1.3", "0.1.4").available,
		).toBe(false)
	})

	it("is unavailable when the version is the running one", () => {
		expect(
			computeUpdateAvailable(available("0.1.3"), "0.1.3", "").available,
		).toBe(false)
	})

	it("is unavailable when the version is older than the running one", () => {
		expect(
			computeUpdateAvailable(available("0.1.2"), "0.1.3", "").available,
		).toBe(false)
	})

	it("re-arms for a strictly newer version after an earlier one was seen", () => {
		expect(
			computeUpdateAvailable(available("0.1.5"), "0.1.3", "0.1.4").available,
		).toBe(true)
	})

	it("is unavailable for a non-semver version without throwing", () => {
		expect(
			computeUpdateAvailable(available("latest"), "0.1.3", "").available,
		).toBe(false)
	})

	it("treats a ready update as available too", () => {
		expect(
			computeUpdateAvailable(
				{ status: "ready", channel: "resources", version: "0.1.4" },
				"0.1.3",
				"",
			),
		).toEqual({ version: "0.1.4", available: true })
	})
})

describe("useUpdateAvailable", () => {
	const listeners = new Set<(state: DesktopUpdateState) => void>()
	let updateState: DesktopUpdateState

	function installBridge(state: DesktopUpdateState): void {
		updateState = state
		const bridge = {
			isDesktop: true,
			platform: "desktop",
			updates: {
				portable: false,
				async status() {
					return updateState
				},
				onStatus(listener: (state: DesktopUpdateState) => void) {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
				async check() {},
				async apply() {},
				async quitAndInstall() {},
			},
		} as unknown as HoardodileDesktopBridge
		window.hoardodileDesktop = bridge
	}

	afterEach(() => {
		Reflect.deleteProperty(window, "hoardodileDesktop")
		localStorage.clear()
		listeners.clear()
	})

	it("writes the lastSeen pref when markUpdateSeen is called and clears the dot", async () => {
		installBridge(available("9.9.9"))
		const { result } = renderHook(() => useUpdateAvailable())

		await waitFor(() => expect(result.current.available).toBe(true))
		expect(result.current.version).toBe("9.9.9")

		act(() => result.current.markUpdateSeen("9.9.9"))
		await waitFor(() => expect(result.current.available).toBe(false))
		expect(localStorage.getItem(prefKeys.updateLastSeenVersion)).toBe("9.9.9")
	})
})
