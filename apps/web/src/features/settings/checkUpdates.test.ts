/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { checkForUpdate, compareVersions } from "./checkUpdates"

describe("compareVersions", () => {
	it("returns 0 for equal versions", () => {
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
	})

	it("ignores a leading v prefix", () => {
		expect(compareVersions("v1.2.3", "1.2.3")).toBe(0)
		expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0)
	})

	it("orders by major, then minor, then patch", () => {
		expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0)
		expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0)
		expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0)
		expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0)
	})

	it("compares numerically, not lexicographically", () => {
		expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0)
	})

	it("treats missing segments as zero", () => {
		expect(compareVersions("1.2", "1.2.0")).toBe(0)
		expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0)
	})

	it("applies semver prerelease ordering", () => {
		expect(compareVersions("0.2.0-alpha.3", "0.2.0-alpha.2")).toBeGreaterThan(0)
		expect(compareVersions("0.2.0-alpha.3", "0.2.0-alpha.3")).toBe(0)
		expect(compareVersions("0.2.0-alpha.3", "0.2.0")).toBeLessThan(0)
		expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0)
		expect(compareVersions("1.0.0-beta", "1.0.0-alpha.1")).toBeGreaterThan(0)
	})
})

describe("checkForUpdate", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	function stubFetch(impl: () => Promise<Response>) {
		vi.stubGlobal("fetch", vi.fn(impl))
	}

	function jsonResponse(body: unknown, status = 200) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		})
	}

	it("returns latest when the remote release is not newer", async () => {
		stubFetch(async () => jsonResponse({ tag_name: "v0.1.0" }))
		expect(await checkForUpdate("0.1.0")).toEqual({ status: "latest" })
	})

	it("returns latest when the remote release is older", async () => {
		stubFetch(async () => jsonResponse({ tag_name: "v0.0.9" }))
		expect(await checkForUpdate("0.1.0")).toEqual({ status: "latest" })
	})

	it("returns latest when the prerelease versions match", async () => {
		stubFetch(async () => jsonResponse({ tag_name: "v0.2.0-alpha.3" }))
		expect(await checkForUpdate("0.2.0-alpha.3")).toEqual({ status: "latest" })
	})

	it("returns latest when a stable release is newer than a prerelease", async () => {
		stubFetch(async () => jsonResponse({ tag_name: "v0.2.0-alpha.3" }))
		expect(await checkForUpdate("0.2.0")).toEqual({ status: "latest" })
	})

	it("returns outdated when a newer prerelease exists", async () => {
		stubFetch(async () => jsonResponse({ tag_name: "v0.2.0-alpha.4" }))
		expect(await checkForUpdate("0.2.0-alpha.3")).toEqual({
			status: "outdated",
			version: "0.2.0-alpha.4",
			url: "https://github.com/hoardodile/hoardodile/releases",
		})
	})

	it("returns outdated with the release url when the remote is newer", async () => {
		stubFetch(async () =>
			jsonResponse({
				tag_name: "v0.2.0",
				html_url:
					"https://github.com/hoardodile/hoardodile/releases/tag/v0.2.0",
			}),
		)
		expect(await checkForUpdate("0.1.0")).toEqual({
			status: "outdated",
			version: "0.2.0",
			url: "https://github.com/hoardodile/hoardodile/releases/tag/v0.2.0",
		})
	})

	it("falls back to the releases page when html_url is missing", async () => {
		stubFetch(async () => jsonResponse({ tag_name: "v0.2.0" }))
		expect(await checkForUpdate("0.1.0")).toEqual({
			status: "outdated",
			version: "0.2.0",
			url: "https://github.com/hoardodile/hoardodile/releases",
		})
	})

	it("returns error on a non-200 response", async () => {
		stubFetch(async () => jsonResponse({}, 403))
		expect(await checkForUpdate("0.1.0")).toEqual({ status: "error" })
	})

	it("returns error when the request fails", async () => {
		stubFetch(async () => {
			throw new Error("network down")
		})
		expect(await checkForUpdate("0.1.0")).toEqual({ status: "error" })
	})

	it("returns error on a malformed payload", async () => {
		stubFetch(async () => jsonResponse({ unexpected: true }))
		expect(await checkForUpdate("0.1.0")).toEqual({ status: "error" })
	})
})
