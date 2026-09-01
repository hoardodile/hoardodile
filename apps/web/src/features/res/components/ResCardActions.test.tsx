import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadResource } from "./ResCardActions"

describe("resource card download", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("always downloads the whole source archive, regardless of count/plugin", () => {
		const hrefs: string[] = []
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			hrefs.push(this.href)
		})

		// No `count` and no plugin lookup: the download targets the
		// plugin-agnostic `source.zip` so a single-archive resource stays
		// whole instead of being reduced to one of its inner files.
		downloadResource({ resId: "res-1" })

		expect(hrefs).toHaveLength(1)
		expect(hrefs[0]!).toMatch(/\/api\/resources\/res-1\/source\.zip$/)
	})
})
