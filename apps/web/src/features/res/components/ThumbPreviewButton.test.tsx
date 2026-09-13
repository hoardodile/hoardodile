import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ThumbPreviewButton } from "./ThumbPreviewButton"

function renderButton(props?: {
	readonly touchVisible?: boolean
	readonly resourceId?: string
}) {
	const onPreviewRequest = vi.fn()
	render(
		<ThumbPreviewButton
			name="Some resource"
			resourceId={props?.resourceId ?? "res-1"}
			onPreviewRequest={onPreviewRequest}
			{...(props?.touchVisible !== undefined
				? { touchVisible: props.touchVisible }
				: {})}
		/>,
	)
	return { onPreviewRequest }
}

describe("ThumbPreviewButton", () => {
	it("stays hover-only by default", () => {
		// The inline BlockNote embed relies on this: a permanently-mounted
		// button would intercept the mousedown ProseMirror needs.
		renderButton()

		const button = screen.getByRole("button", { name: "Some resource" })
		expect(button).toHaveClass("opacity-0", "pointer-events-none")
		expect(button).not.toHaveClass("opacity-100")
		expect(button).toHaveClass("group-hover:opacity-100")
		// No touch-screen override: the button stays hidden below `md` too.
		expect(button).not.toHaveClass("md:opacity-0")
	})

	it("is always visible on touch screens when opted in", () => {
		renderButton({ touchVisible: true })

		const button = screen.getByRole("button", { name: "Some resource" })
		expect(button).toHaveClass("opacity-100", "pointer-events-auto")
		// Desktop (`md:` and up) keeps the hover-reveal behavior, mirroring
		// the card actions trigger.
		expect(button).toHaveClass(
			"md:opacity-0",
			"md:pointer-events-none",
			"md:group-hover:opacity-100",
		)
	})

	it("fires the preview callback once per click in both modes", () => {
		const hoverOnly = renderButton()
		fireEvent.click(screen.getByRole("button", { name: "Some resource" }))
		expect(hoverOnly.onPreviewRequest).toHaveBeenCalledTimes(1)

		const touch = renderButton({ touchVisible: true })
		fireEvent.click(
			screen.getAllByRole("button", { name: "Some resource" })[1]!,
		)
		expect(touch.onPreviewRequest).toHaveBeenCalledTimes(1)
		expect(hoverOnly.onPreviewRequest).toHaveBeenCalledTimes(1)
	})

	it("anchors itself absolutely without owning a containing block", () => {
		// Placement is the parent's job (the card's cover row, or a box
		// hugging an inline embed) — a `relative` here would silently move
		// the button back onto whatever box happens to be closest.
		renderButton()

		const classes = screen
			.getByRole("button", { name: "Some resource" })
			.className.split(/\s+/)
		expect(classes).toEqual(
			expect.arrayContaining(["absolute", "right-2", "top-2", "z-10"]),
		)
		expect(classes).not.toContain("relative")
	})

	it("carries the resource id test hook only when given one", () => {
		renderButton({ resourceId: "res-7" })
		expect(screen.getByTestId("resource-preview-res-7")).toBeInTheDocument()

		render(<ThumbPreviewButton name="No id" onPreviewRequest={() => {}} />)
		const button = screen.getByRole("button", { name: "No id" })
		expect(button).not.toHaveAttribute("data-testid")
	})
})
