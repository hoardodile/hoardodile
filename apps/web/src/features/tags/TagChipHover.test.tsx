import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TagChipHover } from "./TagChipHover"

type MockTag = {
	readonly id: string
	readonly name: string
	readonly intro: string
	readonly color: string
	readonly link?: string
	readonly imageMeta?: unknown
	readonly position: number
	readonly pinned: boolean
	readonly catId: string
	readonly displayTagId: string
	readonly createdAt: number
	readonly updatedAt: number
}

// `vi.hoisted` keeps the data above the hoisted mock factory so the
// factory never reads an uninitialised binding (fails under the full
// suite's module registry, where the store import resolves earlier).
const { mockTags } = vi.hoisted(() => ({
	mockTags: [
		{
			id: "t1",
			name: "Harbor",
			intro: "A quiet place by the sea",
			color: "#123456",
			link: "www.example.com/harbor",
			imageMeta: { kind: "image", width: 4, height: 8 },
			position: 0,
			pinned: false,
			catId: "c1",
			displayTagId: "t1",
			createdAt: 0,
			updatedAt: 42,
		},
		{
			id: "t2",
			name: "Plain",
			intro: "",
			color: "",
			position: 0,
			pinned: false,
			catId: "c1",
			displayTagId: "t2",
			createdAt: 0,
			updatedAt: 1,
		},
	] as readonly MockTag[],
}))

vi.mock("@/features/tags/store", () => ({
	useTagList: () => mockTags,
}))

describe("TagChipHover", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("opens the card on hover and shows art, name, intro and hostname link", async () => {
		render(
			<TagChipHover tagId="t1">
				<span data-testid="chip">Harbor</span>
			</TagChipHover>,
		)
		expect(screen.queryByTestId("tag-hover-name-t1")).toBeNull()

		fireEvent.mouseEnter(screen.getByTestId("chip"))
		await act(async () => {
			vi.advanceTimersByTime(200)
		})

		expect(screen.getByTestId("tag-hover-name-t1")).toHaveTextContent("Harbor")
		expect(screen.getByText("A quiet place by the sea")).toBeInTheDocument()
		const link = screen.getByTestId("tag-hover-link-t1")
		expect(link).toHaveTextContent("example.com")
		expect(link).toHaveAttribute("href", "https://www.example.com/harbor")
		const img = document.querySelector("img")
		expect(img?.getAttribute("src")).toContain("/api/tags/t1/thumb/image?v=42")

		fireEvent.mouseLeave(screen.getByTestId("chip"))
		await act(async () => {
			vi.advanceTimersByTime(300)
		})
		expect(screen.queryByTestId("tag-hover-name-t1")).toBeNull()
	})

	it("opens the card on keyboard focus of the trigger", async () => {
		render(
			<TagChipHover tagId="t1">
				<span data-testid="chip-focus">Harbor</span>
			</TagChipHover>,
		)
		fireEvent.mouseMove(screen.getByTestId("chip-focus"))
		fireEvent.focus(screen.getByTestId("chip-focus"))
		await act(async () => {
			vi.advanceTimersByTime(200)
		})
		expect(screen.getByTestId("tag-hover-name-t1")).toBeInTheDocument()
	})

	it("renders the chip bare when the tag has nothing to show", () => {
		const { container } = render(
			<TagChipHover tagId="t2">
				<span data-testid="chip-plain">Plain</span>
			</TagChipHover>,
		)
		expect(screen.getByTestId("chip-plain")).toBeInTheDocument()
		expect(container.querySelector('[data-slot="preview-card"]')).toBeNull()
	})

	it("renders the chip bare for an unknown tag id", () => {
		const { container } = render(
			<TagChipHover tagId="nope">
				<span data-testid="chip-unknown">Unknown</span>
			</TagChipHover>,
		)
		expect(screen.getByTestId("chip-unknown")).toBeInTheDocument()
		expect(container.querySelector('[data-slot="preview-card"]')).toBeNull()
	})

	it("does not intercept plain clicks on the chip", async () => {
		const onClick = vi.fn()
		render(
			<TagChipHover tagId="t1">
				<button type="button" data-testid="chip-click" onClick={onClick}>
					Harbor
				</button>
			</TagChipHover>,
		)
		fireEvent.click(screen.getByTestId("chip-click"))
		expect(onClick).toHaveBeenCalledTimes(1)
	})
})
