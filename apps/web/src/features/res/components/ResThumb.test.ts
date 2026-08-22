/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { buildResThumbUrl } from "./ResThumb"

describe("buildResThumbUrl", () => {
	it("uses a stable URL without v= for list cards", () => {
		expect(buildResThumbUrl("res-1")).toBe(
			"/api/resources/res-1/cover?size=thumb",
		)
	})

	it("appends bust only when the client clears thumb cache", () => {
		expect(buildResThumbUrl("res-1", { bust: 3 })).toBe(
			"/api/resources/res-1/cover?size=thumb&bust=3",
		)
	})

	it("still supports explicit v= when callers pass cacheKey", () => {
		expect(buildResThumbUrl("res-1", { cacheKey: "2-video-clip.mp4" })).toBe(
			"/api/resources/res-1/cover?size=thumb&v=2-video-clip.mp4",
		)
	})

	it("does not change URL when list prop later gains coverMeta semantics", () => {
		const stable = buildResThumbUrl("res-1")
		const withBust = buildResThumbUrl("res-1", { bust: 1 })
		expect(stable).toBe("/api/resources/res-1/cover?size=thumb")
		expect(withBust).toBe("/api/resources/res-1/cover?size=thumb&bust=1")
	})
})
