/**
 * @vitest-environment jsdom
 */

import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DocEditorSkeleton } from "./DocEditorSkeleton"

describe("DocEditorSkeleton", () => {
	it("renders a visible, content-shaped loading skeleton", () => {
		const { container, getByTestId } = render(<DocEditorSkeleton />)
		expect(getByTestId("document-editor-skeleton")).toBeTruthy()

		const lines = container.querySelectorAll('[data-slot="skeleton"]')
		expect(lines.length).toBeGreaterThan(1)

		// The placeholder must be visible — it must not fall back to the
		// old `bg-transparent`/`bg-muted` void on themed document palettes.
		for (const line of Array.from(lines)) {
			const className = line.className
			expect(className).not.toContain("bg-transparent")
			expect(className).toContain("bg-foreground/20")
		}
	})
})
