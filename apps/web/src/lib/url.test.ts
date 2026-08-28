import { describe, expect, it } from "vitest"
import { hostnameOf, withScheme } from "./url"

describe("withScheme", () => {
	it("prepends https:// when the scheme is missing", () => {
		expect(withScheme("example.com/a")).toBe("https://example.com/a")
	})

	it("keeps an existing scheme", () => {
		expect(withScheme("http://example.com/a")).toBe("http://example.com/a")
		expect(withScheme("ftp://example.com/a")).toBe("ftp://example.com/a")
	})

	it("keeps weird strings unchanged", () => {
		expect(withScheme("::not-a-url")).toBe("https://::not-a-url")
	})
})

describe("hostnameOf", () => {
	it("extracts and strips the www. prefix", () => {
		expect(hostnameOf("https://www.example.com/a")).toBe("example.com")
		expect(hostnameOf("https://sub.example.com/a")).toBe("sub.example.com")
	})

	it("normalises scheme-less pastes first", () => {
		expect(hostnameOf("www.example.com/art")).toBe("example.com")
		expect(hostnameOf("example.com")).toBe("example.com")
	})

	it("returns undefined for unparsable input", () => {
		expect(hostnameOf("::not-a-url")).toBeUndefined()
	})
})
