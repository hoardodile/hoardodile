/**
 * @vitest-environment node
 */

import { detectPlatform } from "./detectPlatform"

describe("detectPlatform", () => {
	const originalNavigator = global.navigator

	function setUserAgent(ua: string) {
		Object.defineProperty(global, "navigator", {
			value: {
				...originalNavigator,
				userAgent: ua,
			},
			configurable: true,
		})
	}

	afterEach(() => {
		Object.defineProperty(global, "navigator", {
			value: originalNavigator,
			configurable: true,
		})
	})

	test("detects desktop chrome as web-pc", () => {
		setUserAgent(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
		)

		expect(detectPlatform()).toBe("web-pc")
	})

	test("detects mobile safari as web-mobile", () => {
		setUserAgent(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		)

		expect(detectPlatform()).toBe("web-mobile")
	})

	test("detects android chrome as web-mobile", () => {
		setUserAgent(
			"Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
		)

		expect(detectPlatform()).toBe("web-mobile")
	})

	test("detects ipad safari as web-mobile", () => {
		setUserAgent(
			"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		)

		expect(detectPlatform()).toBe("web-mobile")
	})

	test("reports desktop when the preload bridge is present", () => {
		setUserAgent(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
		)
		const previous = globalThis.window
		Object.defineProperty(globalThis, "window", {
			value: {
				hoardodileDesktop: { isDesktop: true, platform: "desktop" },
			},
			configurable: true,
		})
		try {
			expect(detectPlatform()).toBe("desktop")
		} finally {
			if (previous === undefined) {
				Reflect.deleteProperty(globalThis, "window")
			} else {
				Object.defineProperty(globalThis, "window", {
					value: previous,
					configurable: true,
				})
			}
		}
	})
})
