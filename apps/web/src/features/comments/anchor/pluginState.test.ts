import { describe, expect, it } from "vitest"
import { decodeAnchorPluginState } from "./pluginState"

describe("anchor pluginState", () => {
	it("passes non-string payloads through untouched", () => {
		const payload = { pageIndex: 1 }
		// The host transports the payload without ever interpreting it.
		expect(decodeAnchorPluginState(payload)).toBe(payload)
		expect(decodeAnchorPluginState(123)).toBe(123)
		expect(decodeAnchorPluginState(null)).toBeNull()
	})

	it("back-decodes a legacy encoded string after the router's single decode", () => {
		// Legacy URLs carried `?pluginState=%257B…`; the router decodes once
		// to `%7B…`, which must still yield the original payload.
		expect(decodeAnchorPluginState("%7B%22pageIndex%22%3A1%7D")).toEqual({
			pageIndex: 1,
		})
	})

	it("resolves malformed values to undefined instead of throwing", () => {
		expect(decodeAnchorPluginState("not-json!")).toBeUndefined()
		expect(decodeAnchorPluginState("%7Btruncated")).toBeUndefined()
	})
})
