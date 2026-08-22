import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"
import { TagChipLink } from "./TagChipLink"

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { readonly children: ReactNode }) => (
		<a {...props}>{children}</a>
	),
}))

describe("TagChipLink", () => {
	test("renders a plain real chip without the weakened class", () => {
		render(<TagChipLink id="t1" name="Real" color="" type="resource" />)
		expect(screen.getByText("Real").closest("span")?.className).not.toContain(
			"opacity-60",
		)
	})

	test("virtual chips render weakened", () => {
		render(
			<TagChipLink id="t2" name="Virtual" color="" type="resource" virtual />,
		)
		expect(
			screen.getByText("Virtual").closest("span")?.parentElement?.className,
		).toContain("opacity-60")
	})

	test("link mode renders the chip as an anchor to the filtered list", () => {
		render(<TagChipLink id="t3" name="Linked" color="" type="character" />)
		expect(screen.getByText("Linked").closest("a")).not.toBeNull()
	})
})
