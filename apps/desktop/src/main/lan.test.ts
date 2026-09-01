/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { computeLanAddresses, lanUrlFor } from "./lan.ts"

function v4(address: string, internal = false) {
	return { address, family: "IPv4" as const, internal }
}

describe("computeLanAddresses", () => {
	it("lists non-internal IPv4 addresses, private ranges first", () => {
		const addresses = computeLanAddresses({
			Ethernet: [v4("192.168.1.20")],
			WiFi: [v4("10.0.0.42"), v4("10.0.0.43")],
			Bridge: [v4("172.20.0.1")],
			Tailscale: [v4("100.64.1.5")],
		})
		expect(addresses.map((entry) => entry.address)).toEqual([
			"192.168.1.20",
			"10.0.0.42",
			"10.0.0.43",
			"172.20.0.1",
			"100.64.1.5",
		])
	})

	it("excludes loopback, link-local, and IPv6 entries", () => {
		const addresses = computeLanAddresses({
			Loopback: [v4("127.0.0.1", true)],
			APIPA: [v4("169.254.7.7")],
			WAN: [{ address: "fe80::1", family: "IPv6" as const, internal: false }],
		})
		expect(addresses).toEqual([])
	})

	it("tolerates an empty interface list", () => {
		expect(computeLanAddresses({})).toEqual([])
	})

	it("keeps the interface name with each address", () => {
		const addresses = computeLanAddresses({ Ethernet: [v4("192.168.1.20")] })
		expect(addresses).toEqual([
			{ interfaceName: "Ethernet", address: "192.168.1.20" },
		])
	})
})

describe("lanUrlFor", () => {
	const addresses = [{ interfaceName: "Ethernet", address: "192.168.1.20" }]

	it("builds the primary URL with the default HTTP scheme", () => {
		expect(lanUrlFor(true, 3000, addresses)).toBe("http://192.168.1.20:3000/")
	})

	it("uses https when the opt-in TLS scheme is requested", () => {
		expect(lanUrlFor(true, 3000, addresses, "https")).toBe(
			"https://192.168.1.20:3000/",
		)
	})

	it("returns undefined while sharing is off", () => {
		expect(lanUrlFor(false, 3000, addresses)).toBeUndefined()
	})

	it("returns undefined without reachable addresses", () => {
		expect(lanUrlFor(true, 3000, [])).toBeUndefined()
	})

	it("uses the actual listening port", () => {
		expect(lanUrlFor(true, 4040, addresses)).toBe("http://192.168.1.20:4040/")
	})
})
