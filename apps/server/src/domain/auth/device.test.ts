import { describe, expect, test } from "vitest"
import { classifyOrigin, describeDevice, isLoopbackIp } from "./device.ts"

describe("isLoopbackIp", () => {
	test("accepts the loopback family", () => {
		expect(isLoopbackIp("127.0.0.1")).toBe(true)
		expect(isLoopbackIp("::1")).toBe(true)
		expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true)
	})

	test("rejects LAN and VPN addresses", () => {
		expect(isLoopbackIp("192.168.1.50")).toBe(false)
		expect(isLoopbackIp("10.0.0.2")).toBe(false)
		expect(isLoopbackIp("100.64.1.5")).toBe(false)
		expect(isLoopbackIp(undefined)).toBe(false)
	})
})

describe("classifyOrigin", () => {
	test("maps loopback and LAN peers", () => {
		expect(classifyOrigin("127.0.0.1")).toBe("loopback")
		expect(classifyOrigin("192.168.1.50")).toBe("lan")
	})
})

describe("describeDevice", () => {
	test("detects common browser and OS pairs", () => {
		expect(
			describeDevice(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
			),
		).toBe("Chrome on Windows")
		expect(
			describeDevice(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("Safari on iOS")
		expect(
			describeDevice(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
			),
		).toBe("Edge on Windows")
		expect(
			describeDevice(
				"Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
			),
		).toBe("Firefox on Linux")
	})

	test("names the desktop shell", () => {
		expect(describeDevice("Mozilla/5.0 Electron/38.0.0 Chrome/126.0.0.0")).toBe(
			"Electron desktop",
		)
	})

	test("falls back without detections", () => {
		expect(describeDevice(undefined)).toBe("Unknown device")
		expect(describeDevice("curl/8.4.0")).toBe("Unknown device")
	})
})
