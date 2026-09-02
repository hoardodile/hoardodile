import { describe, expect, it } from "vitest"
import { isRebuildEvent } from "./rebuild-events.ts"

/**
 * Guards the page-side decoder for the dev server's rebuild stream: only
 * a `{"kind":"rebuild"}` frame is treated as a rebuild signal. The
 * `ready` connect frame, keepalive pings and any malformed data must be
 * ignored, otherwise the iframe would remount spuriously.
 */

describe("isRebuildEvent", () => {
	it("accepts exactly the rebuild frame", () => {
		expect(isRebuildEvent('{"kind":"rebuild"}')).toBe(true)
	})

	it("rejects the ready connect frame", () => {
		expect(isRebuildEvent('{"kind":"ready"}')).toBe(false)
	})

	it("rejects other kinds and non-object payloads", () => {
		expect(isRebuildEvent('{"kind":"something"}')).toBe(false)
		expect(isRebuildEvent('"rebuild"')).toBe(false)
		expect(isRebuildEvent("null")).toBe(false)
	})

	it("rejects malformed JSON and empty input", () => {
		expect(isRebuildEvent("not json")).toBe(false)
		expect(isRebuildEvent('{"kind":')).toBe(false)
		expect(isRebuildEvent("")).toBe(false)
	})

	it("rejects a rebuild kind nested in a wrapper object", () => {
		expect(isRebuildEvent('{"data":{"kind":"rebuild"}}')).toBe(false)
	})
})
