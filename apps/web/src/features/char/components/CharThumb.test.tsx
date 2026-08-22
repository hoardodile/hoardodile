import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CharThumb } from "./CharThumb"

describe("CharThumb", () => {
	it("removes the img and shows the full name when the thumb 404s", () => {
		render(
			<CharThumb charId="c1" variant="avatar" cacheKey={0} name="Harbor" />,
		)
		const img = screen.getByTestId("character-thumb-img-c1-avatar")
		expect(img).toBeInTheDocument()

		// jsdom never loads (or errors) images, so drive the 404 path by
		// firing the error event the real route's 404 would produce.
		fireEvent.error(img)

		expect(screen.queryByTestId("character-thumb-img-c1-avatar")).toBeNull()
		expect(screen.getByTestId("character-thumb-c1-avatar")).toHaveTextContent(
			"Harbor",
		)
		expect(screen.getByTestId("character-thumb-c1-avatar")).toHaveClass(
			"bg-muted",
		)
	})

	it("shows the name initial when nameFallback is initial", () => {
		render(
			<CharThumb
				charId="c1"
				variant="avatar"
				cacheKey={0}
				name="Harbor"
				nameFallback="initial"
			/>,
		)
		fireEvent.error(screen.getByTestId("character-thumb-img-c1-avatar"))
		expect(screen.getByTestId("character-thumb-c1-avatar")).toHaveTextContent(
			"H",
		)
	})

	it("still mounts an img when the thumb has not 404ed yet", () => {
		render(
			<CharThumb charId="c1" variant="avatar" cacheKey={0} name="Harbor" />,
		)
		expect(screen.getByTestId("character-thumb-img-c1-avatar")).toHaveClass(
			"h-full",
			"w-full",
			"object-cover",
		)
	})

	it("renders an empty tile when the character has no image and no name", () => {
		render(<CharThumb charId="c2" variant="avatar" cacheKey={0} />)
		fireEvent.error(screen.getByTestId("character-thumb-img-c2-avatar"))
		expect(screen.queryByTestId("character-thumb-img-c2-avatar")).toBeNull()
		expect(screen.getByTestId("character-thumb-c2-avatar")).toHaveTextContent(
			"",
		)
	})
})
