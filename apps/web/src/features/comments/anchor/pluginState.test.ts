import { describe, expect, it } from "vitest"
import { decodeAnchorPluginState, encodeAnchorPluginState } from "./pluginState"

/**
 * The router's default search pipeline (`stringifySearchWith` + qss +
 * `parseSearchWith(JSON.parse)` in `@tanstack/router-core`): qss
 * URLSearchParams-encodes the value, parsing decodes it once and then
 * attempts `JSON.parse`, falling back to the raw string.
 */
function routerRoundTrip(pluginState: string): unknown {
	const query = new URLSearchParams({ pluginState }).toString()
	const value = new URLSearchParams(query).get("pluginState")
	if (value === null) return undefined
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}

describe("anchor pluginState", () => {
	it("round-trips an object payload as a string through the router parser", () => {
		const payload = { pageIndex: 1 }
		const arrived = routerRoundTrip(encodeAnchorPluginState(payload))
		// The double encoding must survive the router's JSON parsing as a
		// plain string (the `z.string()` schema depends on it)…
		expect(typeof arrived).toBe("string")
		// …and decode back to the original payload.
		expect(decodeAnchorPluginState(arrived as string)).toEqual(payload)
	})

	it("keeps the URL bytes of the legacy window.location navigation", () => {
		const encoded = encodeAnchorPluginState({ pageIndex: 1 })
		expect(new URLSearchParams({ pluginState: encoded }).toString()).toBe(
			"pluginState=%257B%2522pageIndex%2522%253A1%257D",
		)
	})

	it("round-trips array, string and number payloads", () => {
		const samples: readonly unknown[] = [[1, 2], "hello", 123]
		for (const payload of samples) {
			const arrived = routerRoundTrip(encodeAnchorPluginState(payload))
			expect(decodeAnchorPluginState(String(arrived))).toEqual(payload)
		}
	})

	it("resolves malformed values to undefined instead of throwing", () => {
		expect(decodeAnchorPluginState("not-json!")).toBeUndefined()
		expect(decodeAnchorPluginState("%7Btruncated")).toBeUndefined()
	})
})
