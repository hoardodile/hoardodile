/**
 * @vitest-environment node
 *
 * The app-reopen update copy must stay simple and user-friendly: no
 * "应用壳 / app shell" (a technical detail a regular user doesn't need) and
 * no "重启 / restart" (users read that as reboot-the-computer — the action
 * is "reopen the app"). Locks the requirement so it can't silently regress.
 */

import { describe, expect, it } from "vitest"
import { CATALOGS } from "./catalogs.ts"

/** Every app-reopen update string, keyed by its path in a catalog. */
const UPDATE_KEYS: readonly (readonly string[])[] = [
	["me", "about", "updateReady"],
	["me", "about", "updateReadyResources"],
	["me", "about", "updateFullReason"],
	["me", "about", "updateResourcesReason"],
	["me", "about", "restartToUpdate"],
	["me", "desktop", "updateBanner"],
	["me", "desktop", "updateBannerResources"],
	["me", "desktop", "updateBannerRestart"],
	["me", "desktop", "autoUpdate", "description"],
	["desktopShell", "tray", "updateReady"],
	["desktopShell", "tray", "updateReadyResources"],
	["desktopShell", "wizard", "missingBridge"],
]

function valueAt(obj: unknown, path: readonly string[]): string | undefined {
	let current: unknown = obj
	for (const key of path) {
		if (typeof current !== "object" || current === null) return undefined
		current = (current as Record<string, unknown>)[key]
	}
	return typeof current === "string" ? current : undefined
}

describe("update copy stays simple and user-friendly", () => {
	const FORBIDDEN = [/restart/i, /重启/, /app\s+shell/i, /应用壳/i]

	it("never uses 'restart/重启' or 'app shell/应用壳' in app-reopen copy", () => {
		for (const [language, catalog] of Object.entries(CATALOGS)) {
			for (const path of UPDATE_KEYS) {
				const value = valueAt(catalog, path)
				expect(value, `${language}: ${path.join(".")} is missing`).toBeDefined()
				for (const re of FORBIDDEN) {
					expect(value?.match(re), `${language}: ${path.join(".")}`).toBeNull()
				}
			}
		}
	})
})
