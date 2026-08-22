import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RoutePendingFallback } from "./page-scaffold"

describe("RoutePendingFallback", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("renders the header skeletons without invalid DOM nesting", () => {
		// React's dev-time validator logs "cannot be a descendant of <p>" /
		// "cannot contain a nested <div>" for a block element inside the
		// header's h1/p wrappers — a hydration hazard.
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined)
		render(<RoutePendingFallback />)
		for (const call of errorSpy.mock.calls) {
			const message = String(call[0])
			expect(message).not.toContain("cannot be a descendant")
			expect(message).not.toContain("cannot contain a nested")
		}
	})
})
