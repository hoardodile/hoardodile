// @vitest-environment node
import { describe, expect, it } from "vitest"
import { SETTINGS_TABS, visibleSettingsTabs } from "./settingsTabs"

describe("settingsTabs", () => {
	it("holds every settings tab", () => {
		expect(SETTINGS_TABS.map((tab) => tab.key)).toEqual([
			"preferences",
			"data",
			"about",
			"desktop",
			"custom",
			"privacy",
			"archive",
			"plugins",
			"marketplace",
			"sync",
		])
	})

	it("shows every tab including the desktop one in the shell", () => {
		expect(visibleSettingsTabs(true)).toHaveLength(SETTINGS_TABS.length)
	})

	it("hides the desktop-only tab in a normal browser tab", () => {
		const tabs = visibleSettingsTabs(false)
		expect(tabs.map((tab) => tab.key)).not.toContain("desktop")
		expect(tabs).toHaveLength(SETTINGS_TABS.length - 1)
		for (const tab of tabs) {
			expect(tab.desktopOnly).not.toBe(true)
		}
	})
})
