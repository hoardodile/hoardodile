import { describe, expect, it } from "vitest"
import { isMinAppSatisfied, marketUpdateAvailable } from "./compat"

function marketPlugin(overrides?: {
	readonly state?: "ok" | "no_release" | "error"
	readonly latestVersion?: string
	readonly minAppVersion?: string
}) {
	return {
		state: overrides?.state ?? "ok",
		latest:
			overrides?.latestVersion === undefined
				? { version: "1.2.3" }
				: { version: overrides.latestVersion },
		manifest: { minAppVersion: overrides?.minAppVersion },
	}
}

describe("isMinAppSatisfied", () => {
	it("always allows a plugin without a minimum version", () => {
		expect(isMinAppSatisfied({}, "0.1.1")).toBe(true)
	})

	it("accepts an equal or lower minimum", () => {
		expect(isMinAppSatisfied({ minAppVersion: "0.1.1" }, "0.1.1")).toBe(true)
		expect(isMinAppSatisfied({ minAppVersion: "0.0.1" }, "0.1.1")).toBe(true)
		expect(isMinAppSatisfied({ minAppVersion: "v0.1.1" }, "0.1.1")).toBe(true)
	})

	it("rejects a minimum above the current app version", () => {
		expect(isMinAppSatisfied({ minAppVersion: "0.2.0" }, "0.1.1")).toBe(false)
		expect(isMinAppSatisfied({ minAppVersion: "1.0.0" }, "0.1.1")).toBe(false)
	})

	it("tolerates an unparseable minimum", () => {
		expect(isMinAppSatisfied({ minAppVersion: "banana" }, "0.1.1")).toBe(true)
	})
})

describe("marketUpdateAvailable", () => {
	it("is true for a newer, compatible release of an installed plugin", () => {
		expect(
			marketUpdateAvailable(marketPlugin({ latestVersion: "1.2.3" }), "1.1.0"),
		).toBe(true)
	})

	it("signals an update for a rate-limited version-only release (version known, no asset)", () => {
		// The free `releases.atom` fallback supplies a version without an
		// asset — the badge/filter/dot must still surface the update.
		const plugin = marketPlugin({ latestVersion: "1.3.0" })
		expect(plugin.latest).toEqual({ version: "1.3.0" })
		expect(marketUpdateAvailable(plugin, "1.2.3")).toBe(true)
	})

	it("is false when not installed, up to date or without a release", () => {
		expect(marketUpdateAvailable(marketPlugin(), undefined)).toBe(false)
		expect(
			marketUpdateAvailable(marketPlugin({ latestVersion: "1.1.0" }), "1.1.0"),
		).toBe(false)
		expect(
			marketUpdateAvailable(marketPlugin({ state: "no_release" }), "1.0.0"),
		).toBe(false)
	})

	it("is false when the update requires a newer app", () => {
		expect(
			marketUpdateAvailable(
				marketPlugin({ latestVersion: "1.2.3", minAppVersion: "9.9.9" }),
				"1.1.0",
			),
		).toBe(false)
	})
})
