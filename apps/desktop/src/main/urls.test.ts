/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { isHttpReachable, isLocalhostHttp, windowOpenDecision } from "./urls.ts"

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

describe("windowOpenDecision", () => {
	it("keeps loopback in the existing window", () => {
		expect(windowOpenDecision("http://127.0.0.1:3000/login")).toBe(
			"same-window",
		)
		expect(windowOpenDecision("https://localhost/x")).toBe("same-window")
	})

	it("sends non-localhost http(s) to the OS browser", () => {
		expect(windowOpenDecision("https://github.com/hoardodile/hoardodile")).toBe(
			"external",
		)
		expect(windowOpenDecision("http://example.com")).toBe("external")
	})

	it("denies non-http schemes", () => {
		expect(windowOpenDecision("file:///C:/tmp")).toBe("deny")
		expect(windowOpenDecision("about:blank")).toBe("deny")
	})
})

describe("isHttpReachable", () => {
	it("returns false when nothing is listening", async () => {
		await expect(isHttpReachable("http://127.0.0.1:9/", 200)).resolves.toBe(
			false,
		)
	})
})
