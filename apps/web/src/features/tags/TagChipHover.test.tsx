import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TagChipHover } from "./TagChipHover"
import { clampDisplaySize } from "./tagHoverSpec"

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
			imageMeta: { kind: "image", width: 4, height: 8, source: "image.png" },
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
		{
			id: "t3",
			name: "Wide",
			intro: "",
			color: "",
			link: "https://example.com/wide",
			imageMeta: { kind: "image", width: 800, height: 600 },
			position: 0,
			pinned: false,
			catId: "c1",
			displayTagId: "t3",
			createdAt: 0,
			updatedAt: 3,
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

	it("opens the card on hover: intro + hostname link, no repeated name, ring on trigger", async () => {
		render(
			<TagChipHover tagId="t1">
				<span data-testid="chip">Harbor</span>
			</TagChipHover>,
		)
		const chip = screen.getByTestId("chip")
		expect(chip.className).toContain("hover:ring-1")

		fireEvent.mouseEnter(chip)
		await act(async () => {
			vi.advanceTimersByTime(250)
		})

		expect(screen.getByText("A quiet place by the sea")).toBeInTheDocument()
		const link = screen.getByTestId("tag-hover-link-t1")
		expect(link).toHaveTextContent("example.com")
		expect(link).toHaveAttribute("href", "https://www.example.com/harbor")
		expect(link.className).toContain("hover:underline")
		// The trigger already names the tag — the name is not repeated.
		expect(screen.queryByTestId("tag-hover-name-t1")).toBeNull()
		const card = screen.getByLabelText("Tag preview: Harbor")
		expect(card).not.toHaveTextContent("Harbor")

		fireEvent.mouseLeave(chip)
		await act(async () => {
			vi.advanceTimersByTime(300)
		})
		expect(screen.queryByTestId("tag-hover-link-t1")).toBeNull()
	})

	it("sizes the artwork from imageMeta into the min/max clamp window", async () => {
		render(
			<TagChipHover tagId="t1">
				<span data-testid="chip-small">Harbor</span>
			</TagChipHover>,
		)
		// 4×8 is upscaled just enough to touch the 64×64 floor, aspect kept.
		expect(clampDisplaySize(4, 8)).toEqual({ width: 64, height: 128 })

		fireEvent.mouseEnter(screen.getByTestId("chip-small"))
		await act(async () => {
			vi.advanceTimersByTime(250)
		})
		const img = document.querySelector("img")
		expect(img?.getAttribute("width")).toBe("64")
		expect(img?.getAttribute("height")).toBe("128")
	})

	it("downscales ultra-wide art into the max window", async () => {
		render(
			<TagChipHover tagId="t3">
				<span data-testid="chip-wide">Wide</span>
			</TagChipHover>,
		)
		expect(clampDisplaySize(800, 600)).toEqual({ width: 240, height: 180 })

		fireEvent.mouseEnter(screen.getByTestId("chip-wide"))
		await act(async () => {
			vi.advanceTimersByTime(250)
		})
		const img = document.querySelector("img")
		expect(img?.getAttribute("width")).toBe("240")
		expect(img?.getAttribute("height")).toBe("180")
	})

	it("renders the chip bare when the tag has nothing to show", () => {
		const { container } = render(
			<TagChipHover tagId="t2">
				<span data-testid="chip-plain">Plain</span>
			</TagChipHover>,
		)
		const chip = screen.getByTestId("chip-plain")
		expect(chip.className).not.toContain("hover:ring-1")
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
})
