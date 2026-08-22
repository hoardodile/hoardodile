import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	isRouteScrollTracked,
	readRouteScroll,
	routeScrollKey,
	writeRouteScroll,
} from "./routeScrollRestore"

beforeEach(() => {
	sessionStorage.clear()
})

afterEach(() => {
	sessionStorage.clear()
})

describe("routeScrollKey", () => {
	it("combines pathname and search", () => {
		expect(routeScrollKey("/resources", "?filter=x")).toContain("/resources")
		expect(routeScrollKey("/resources", "?filter=x")).toContain("?filter=x")
		expect(routeScrollKey("/resources", "")).not.toBe(
			routeScrollKey("/documents", ""),
		)
	})
})

describe("isRouteScrollTracked", () => {
	it("tracks ordinary routes", () => {
		expect(isRouteScrollTracked("/")).toBe(true)
		expect(isRouteScrollTracked("/documents/")).toBe(true)
		expect(isRouteScrollTracked("/documents/$id/")).toBe(false)
		expect(isRouteScrollTracked("/resources/$id/")).toBe(false)
		expect(isRouteScrollTracked("/resources/new/")).toBe(true)
	})
})

describe("route scroll session storage", () => {
	it("round-trips a position", () => {
		const key = routeScrollKey("/documents", "")
		writeRouteScroll(key, 420)
		expect(readRouteScroll(key)).toBe(420)
	})

	it("returns undefined when nothing was stored", () => {
		expect(readRouteScroll(routeScrollKey("/nope", ""))).toBeUndefined()
	})

	it("rejects non-numeric or negative stored values", () => {
		const key = routeScrollKey("/x", "")
		sessionStorage.setItem(key, "oops")
		expect(readRouteScroll(key)).toBeUndefined()
		sessionStorage.setItem(key, "-5")
		expect(readRouteScroll(key)).toBeUndefined()
	})
})
