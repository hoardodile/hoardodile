import { afterEach, describe, expect, it } from "vitest"
import {
	armLastRouteRestore,
	clearLastRoute,
	consumeLastRouteRestore,
	isRestorablePath,
	isRestoreArmed,
	readLastRoute,
	writeLastRoute,
} from "./last-route"

const PATTERNS = [
	"/",
	"/documents",
	"/documents/$id",
	"/characters/$id",
	"/settings",
	"/settings/desktop",
	"/search",
]

afterEach(() => {
	clearLastRoute()
	localStorage.clear()
})

describe("last-route storage", () => {
	it("round-trips a route through localStorage", () => {
		writeLastRoute("/documents/12?tab=1")
		expect(readLastRoute()).toBe("/documents/12?tab=1")
	})

	it("ignores empty and oversized values", () => {
		writeLastRoute("")
		expect(readLastRoute()).toBeUndefined()
		writeLastRoute(`/${"x".repeat(2000)}`)
		expect(readLastRoute()).toBeUndefined()
	})

	it("clears both storage and the armed flag", () => {
		writeLastRoute("/search?q=cat")
		armLastRouteRestore(PATTERNS)
		expect(isRestoreArmed()).toBe(true)
		clearLastRoute()
		expect(readLastRoute()).toBeUndefined()
		expect(isRestoreArmed()).toBe(false)
	})
})

describe("armLastRouteRestore", () => {
	it("arms a valid stored route exactly once per boot", () => {
		writeLastRoute("/documents/12")
		armLastRouteRestore(PATTERNS)
		expect(isRestoreArmed()).toBe(true)
		expect(consumeLastRouteRestore()).toBe("/documents/12")
		// One-shot: the second take is empty regardless of repeated calls.
		expect(consumeLastRouteRestore()).toBeUndefined()
	})

	it("clears and skips /login and unknown paths", () => {
		writeLastRoute("/login")
		armLastRouteRestore(PATTERNS)
		expect(isRestoreArmed()).toBe(false)
		expect(readLastRoute()).toBeUndefined()

		writeLastRoute("/bogus/deep")
		armLastRouteRestore(PATTERNS)
		expect(isRestoreArmed()).toBe(false)
		expect(readLastRoute()).toBeUndefined()
	})

	it("does nothing when nothing is stored", () => {
		armLastRouteRestore(PATTERNS)
		expect(isRestoreArmed()).toBe(false)
	})
})

describe("isRestorablePath", () => {
	it("matches literal and wildcard ($) segments only at segment boundaries", () => {
		expect(isRestorablePath("/documents/12", PATTERNS)).toBe(true)
		expect(isRestorablePath("/documents", PATTERNS)).toBe(true)
		expect(isRestorablePath("/search?q=cat", PATTERNS)).toBe(true)
		expect(isRestorablePath("/", PATTERNS)).toBe(true)
		expect(isRestorablePath("/documents/12/extra", PATTERNS)).toBe(false)
		expect(isRestorablePath("/documents/", PATTERNS)).toBe(true)
		expect(isRestorablePath("documents/12", PATTERNS)).toBe(false)
	})

	it("never restores the login page or junk", () => {
		expect(isRestorablePath("/login", PATTERNS)).toBe(false)
		expect(isRestorablePath("not a url", PATTERNS)).toBe(false)
		expect(isRestorablePath(`/${"x".repeat(2000)}`, PATTERNS)).toBe(false)
	})
})
