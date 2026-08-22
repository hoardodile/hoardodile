import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FileListEditor, type FileListEntry } from "./FileListEditor"

function entry(name: string): FileListEntry {
	return { id: name, file: new File(["x"], name, { type: "image/png" }) }
}

describe("FileListEditor", () => {
	it("renders tiles in displayOrder", () => {
		const entries = [entry("a.png"), entry("b.png")]
		render(
			<FileListEditor
				entries={entries}
				displayOrder={[1, 0]}
				onEntriesChange={vi.fn()}
				onOrderChange={vi.fn()}
			/>,
		)

		const strip = screen.getByTestId("upload-file-strip")
		const tiles = strip.querySelectorAll("[data-testid^='upload-file-thumb-']")
		expect(tiles[0]?.getAttribute("data-testid")).toBe(
			"upload-file-thumb-b.png",
		)
		expect(tiles[1]?.getAttribute("data-testid")).toBe(
			"upload-file-thumb-a.png",
		)
	})

	it("maps progress by displayOrder source index", () => {
		const entries = [entry("a.png"), entry("b.png")]
		render(
			<FileListEditor
				entries={entries}
				displayOrder={[1, 0]}
				onEntriesChange={vi.fn()}
				onOrderChange={vi.fn()}
				fileProgresses={[0.2, 0.8]}
			/>,
		)

		// First visible tile is entries[1] (b.png), whose progress is at index 1.
		const bars = screen.getAllByTestId("upload-file-thumb-b.png")
		expect(bars.length).toBeGreaterThan(0)
	})

	it("removes an entry and updates order", async () => {
		const onEntriesChange = vi.fn()
		const onOrderChange = vi.fn()
		const entries = [entry("a.png"), entry("b.png"), entry("c.png")]
		render(
			<FileListEditor
				entries={entries}
				displayOrder={[0, 2, 1]}
				onEntriesChange={onEntriesChange}
				onOrderChange={onOrderChange}
			/>,
		)

		const removeButton = screen
			.getByTestId("upload-file-thumb-b.png")
			.querySelector("button")
		expect(removeButton).not.toBeNull()
		await userEvent.click(removeButton!)

		expect(onEntriesChange).toHaveBeenCalledWith([entries[0], entries[2]])
		expect(onOrderChange).toHaveBeenCalledWith([0, 1])
	})

	it("scrolls horizontally with the vertical wheel", () => {
		const entries = [entry("a.png"), entry("b.png")]
		render(
			<FileListEditor
				entries={entries}
				onEntriesChange={vi.fn()}
				onOrderChange={vi.fn()}
			/>,
		)

		const strip = screen.getByTestId("upload-file-strip")
		Object.defineProperty(strip, "scrollWidth", {
			configurable: true,
			value: 800,
		})
		Object.defineProperty(strip, "clientWidth", {
			configurable: true,
			value: 200,
		})
		Object.defineProperty(strip, "scrollLeft", {
			configurable: true,
			writable: true,
			value: 0,
		})

		strip.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 40, cancelable: true }),
		)
		expect(strip.scrollLeft).toBe(40)
	})

	it("adds files and appends to order", async () => {
		const onEntriesChange = vi.fn()
		const onOrderChange = vi.fn()
		const entries = [entry("a.png")]
		render(
			<FileListEditor
				entries={entries}
				onEntriesChange={onEntriesChange}
				onOrderChange={onOrderChange}
			/>,
		)

		const input = screen.getByTestId("create-resource-files")
		const file = new File(["x"], "b.png", { type: "image/png" })
		await fireEvent.change(input, { target: { files: [file] } })

		expect(onEntriesChange).toHaveBeenCalled()
		const passedEntries = onEntriesChange.mock.calls[0]?.[0] as
			| FileListEntry[]
			| undefined
		expect(passedEntries?.length).toBe(2)
		expect(passedEntries?.[0]).toBe(entries[0])
		expect(passedEntries?.[1]?.file).toBe(file)

		expect(onOrderChange).toHaveBeenCalledWith([0, 1])
	})

	it("flags tiles whose name is duplicated in the batch", () => {
		const entries = [
			{ id: "e1", file: new File(["x"], "1.png", { type: "image/png" }) },
			{ id: "e2", file: new File(["x"], "1.png", { type: "image/png" }) },
			{ id: "e3", file: new File(["x"], "2.png", { type: "image/png" }) },
			{ id: "e4", file: new File(["x"], "1.PNG", { type: "image/png" }) },
		]
		render(
			<FileListEditor
				entries={entries}
				onEntriesChange={vi.fn()}
				onOrderChange={vi.fn()}
			/>,
		)

		// Duplicate detection is case-insensitive, matching the server.
		expect(
			within(screen.getByTestId("upload-file-thumb-e1")).getByText(
				"Duplicate name",
			),
		).toBeInTheDocument()
		expect(
			within(screen.getByTestId("upload-file-thumb-e2")).getByText(
				"Duplicate name",
			),
		).toBeInTheDocument()
		expect(
			within(screen.getByTestId("upload-file-thumb-e4")).getByText(
				"Duplicate name",
			),
		).toBeInTheDocument()
		expect(
			within(screen.getByTestId("upload-file-thumb-e3")).queryByText(
				"Duplicate name",
			),
		).not.toBeInTheDocument()
	})
})
