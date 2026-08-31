/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	appUrlPreservingRoute,
	appWindowDecision,
	isHttpReachable,
	isLocalhostHttp,
	matchesAppRoute,
	wizardWindowDecision,
} from "./urls.ts"

/** Stand-in for the route patterns the SPA registers at boot. */
const ROUTES = [
	"/",
	"/login",
	"/documents",
	"/documents/$id",
	"/characters/$id",
	"/characters/new",
	"/resources/$id",
	"/settings/about",
	"/settings/data",
]

describe("isLocalhostHttp", () => {
	it("allows loopback http(s)", () => {
		expect(isLocalhostHttp("http://127.0.0.1:3000/login")).toBe(true)
		expect(isLocalhostHttp("https://localhost/x")).toBe(true)
	})

	it("rejects non-localhost http(s)", () => {
		expect(isLocalhostHttp("https://github.com/hoardodile/hoardodile")).toBe(
			false,
		)
		expect(isLocalhostHttp("http://example.com")).toBe(false)
	})
})

describe("matchesAppRoute", () => {
	it("matches literal and param segments", () => {
		expect(matchesAppRoute("/characters/r-1", ROUTES)).toBe(true)
		expect(matchesAppRoute("/characters/new", ROUTES)).toBe(true)
		expect(matchesAppRoute("/settings/data", ROUTES)).toBe(true)
	})

	it("ignores trailing slashes", () => {
		expect(matchesAppRoute("/characters/r-1/", ROUTES)).toBe(true)
		expect(matchesAppRoute("/characters/", ["/characters"])).toBe(true)
		expect(matchesAppRoute("/characters/r-1", ["/characters/$id/"])).toBe(true)
	})

	it("rejects non-route paths", () => {
		expect(matchesAppRoute("/LICENSE", ROUTES)).toBe(false)
		expect(matchesAppRoute("/api/plugins/gallery/index.html", ROUTES)).toBe(
			false,
		)
		expect(matchesAppRoute("/sw.js", ROUTES)).toBe(false)
		expect(matchesAppRoute("/characters/r-1/edit", ROUTES)).toBe(false)
		expect(matchesAppRoute("/characters", ["/characters/$id"])).toBe(false)
	})

	it("decodes percent-encoded path segments", () => {
		expect(matchesAppRoute("/characters/a%2Fb", ["/characters/$id"])).toBe(true)
	})

	it("handles the root separately from child paths", () => {
		expect(matchesAppRoute("/", ["/", "/login"])).toBe(true)
		expect(matchesAppRoute("/", ["/login"])).toBe(false)
		expect(matchesAppRoute("/login", ["/"])).toBe(false)
	})
})

describe("appWindowDecision", () => {
	const APP_URL = "http://127.0.0.1:3000/"

	it("keeps registered same-origin routes in the window", () => {
		expect(
			appWindowDecision(
				"http://127.0.0.1:3000/characters/r-1",
				APP_URL,
				ROUTES,
			),
		).toBe("same-window")
		expect(
			appWindowDecision(
				"http://127.0.0.1:3000/settings/data?tab=1",
				APP_URL,
				ROUTES,
			),
		).toBe("same-window")
	})

	it("treats localhost and 127.0.0.1 on the same port as one origin", () => {
		expect(
			appWindowDecision(
				"http://localhost:3000/characters/r-1",
				APP_URL,
				ROUTES,
			),
		).toBe("same-window")
	})

	it("sends same-origin non-SPA paths to the OS browser", () => {
		expect(
			appWindowDecision("http://127.0.0.1:3000/LICENSE", APP_URL, ROUTES),
		).toBe("external")
		expect(
			appWindowDecision(
				"http://127.0.0.1:3000/api/plugins/gallery/index.html",
				APP_URL,
				ROUTES,
			),
		).toBe("external")
		expect(
			appWindowDecision("http://127.0.0.1:3000/sw.js", APP_URL, ROUTES),
		).toBe("external")
	})

	it("sends other loopback ports or hosts to the OS browser", () => {
		expect(appWindowDecision("http://127.0.0.1:8080/", APP_URL, ROUTES)).toBe(
			"external",
		)
		expect(appWindowDecision("http://localhost:5173/", APP_URL, ROUTES)).toBe(
			"external",
		)
	})

	it("sends non-loopback http(s) to the OS browser", () => {
		expect(
			appWindowDecision(
				"https://github.com/hoardodile/hoardodile",
				APP_URL,
				ROUTES,
			),
		).toBe("external")
		expect(appWindowDecision("http://example.com", APP_URL, ROUTES)).toBe(
			"external",
		)
	})

	it("denies non-http schemes", () => {
		expect(appWindowDecision("file:///C:/tmp", APP_URL, ROUTES)).toBe("deny")
		expect(appWindowDecision("about:blank", APP_URL, ROUTES)).toBe("deny")
		expect(appWindowDecision("mailto:x@y.z", APP_URL, ROUTES)).toBe("deny")
	})

	it("allows only the app root before routes are registered", () => {
		expect(appWindowDecision("http://127.0.0.1:3000/", APP_URL, [])).toBe(
			"same-window",
		)
		expect(appWindowDecision("http://127.0.0.1:3000/login", APP_URL, [])).toBe(
			"external",
		)
	})

	it("never keeps a URL whose current frame is not the app", () => {
		expect(
			appWindowDecision("http://127.0.0.1:3000/login", "about:blank", ROUTES),
		).toBe("external")
	})
})

describe("wizardWindowDecision", () => {
	it("keeps loopback in the existing window", () => {
		expect(wizardWindowDecision("http://127.0.0.1:5174/")).toBe("same-window")
		expect(wizardWindowDecision("https://localhost/x")).toBe("same-window")
	})

	it("sends non-localhost http(s) to the OS browser", () => {
		expect(
			wizardWindowDecision("https://github.com/hoardodile/hoardodile"),
		).toBe("external")
		expect(wizardWindowDecision("http://example.com")).toBe("external")
	})

	it("denies non-http schemes", () => {
		expect(wizardWindowDecision("file:///C:/tmp")).toBe("deny")
		expect(wizardWindowDecision("about:blank")).toBe("deny")
	})
})

describe("appUrlPreservingRoute", () => {
	it("carries the current SPA route onto a new app URL", () => {
		expect(
			appUrlPreservingRoute(
				"http://127.0.0.1:3000/settings/about?tab=general#top",
				"http://127.0.0.1:4040/",
			),
		).toBe("http://127.0.0.1:4040/settings/about?tab=general#top")
	})

	it("preserves the route when only the port changed (port drift)", () => {
		expect(
			appUrlPreservingRoute(
				"http://127.0.0.1:3000/resources/abc",
				"http://127.0.0.1:3001/",
			),
		).toBe("http://127.0.0.1:3001/resources/abc")
	})

	it("keeps a plain root when the current frame is not the app", () => {
		expect(appUrlPreservingRoute("about:blank", "http://127.0.0.1:3000/")).toBe(
			"http://127.0.0.1:3000/",
		)
		expect(
			appUrlPreservingRoute(
				"https://github.com/hoardodile/hoardodile",
				"http://127.0.0.1:3000/",
			),
		).toBe("http://127.0.0.1:3000/")
		expect(
			appUrlPreservingRoute(
				"file:///C:/tmp/error.html",
				"http://127.0.0.1:3000/",
			),
		).toBe("http://127.0.0.1:3000/")
	})

	it("falls back to the raw appUrl when it is not http(s)", () => {
		expect(
			appUrlPreservingRoute("http://127.0.0.1:3000/login", "about:blank"),
		).toBe("about:blank")
	})
})

describe("isHttpReachable", () => {
	it("returns false when nothing is listening", async () => {
		await expect(isHttpReachable("http://127.0.0.1:9/", 200)).resolves.toBe(
			false,
		)
	})
})
