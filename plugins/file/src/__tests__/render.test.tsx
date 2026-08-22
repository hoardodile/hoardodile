import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildTreeData, FilePreviewPane, FileTreeContent } from "../render"
import type { FileEntry } from "../shared"

vi.mock("../i18n", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		language: "en",
	}),
}))

const FILES: readonly FileEntry[] = [
	{ filename: "a.png", sizeBytes: 100, ext: ".png" },
	{ filename: "b.jpg", sizeBytes: 200, ext: ".jpg" },
	{ filename: "chapter/c.png", sizeBytes: 300, ext: ".png" },
]

async function renderTree(files: readonly FileEntry[]) {
	await act(async () => {
		render(<FileTreeContent files={files} />)
	})
}

describe("plugin-file FileTreeContent", () => {
	it("renders a flat entry with its name and size", async () => {
		await renderTree([FILES[0]!])
		expect(screen.getByText("a.png")).toBeTruthy()
		expect(screen.getByText("100.0 B")).toBeTruthy()
	})

	it("renders the file count badge", async () => {
		await renderTree(FILES)
		expect(screen.getByText("3")).toBeTruthy()
	})

	it("renders folders expanded with their children", async () => {
		await renderTree(FILES)
		expect(screen.getByText("chapter")).toBeTruthy()
		expect(screen.getByText("c.png")).toBeTruthy()
		const folder = screen.getByText("chapter").closest("button")
		expect(folder?.getAttribute("aria-expanded")).toBe("true")
	})

	it("collapses a folder on click, hiding its children", async () => {
		await renderTree(FILES)
		const folder = screen.getByText("chapter").closest("button")
		expect(folder).not.toBeNull()
		await act(async () => {
			fireEvent.click(folder!)
		})
		expect(screen.queryByText("c.png")).toBeNull()
		expect(screen.getByText("chapter")).toBeTruthy()
		expect(
			screen
				.getByText("chapter")
				.closest("button")
				?.getAttribute("aria-expanded"),
		).toBe("false")
	})

	it("selects a leaf on click and highlights it", async () => {
		const onSelect = vi.fn()
		await act(async () => {
			render(
				<FileTreeContent
					files={[FILES[0]!]}
					onSelect={onSelect}
					selected="a.png"
				/>,
			)
		})
		await act(async () => {
			fireEvent.click(screen.getByText("a.png"))
		})
		expect(onSelect).toHaveBeenCalledWith("a.png")
		expect(
			screen.getByText("a.png").closest('span[data-slot="tree-item-label"]')
				?.className,
		).toContain("bg-accent")
	})

	it("does not select folders", async () => {
		const onSelect = vi.fn()
		await act(async () => {
			render(<FileTreeContent files={FILES} onSelect={onSelect} />)
		})
		const folder = screen.getByText("chapter").closest("button")
		await act(async () => {
			fireEvent.click(folder!)
		})
		expect(onSelect).not.toHaveBeenCalled()
	})

	it("sorts siblings in natural order (2 before 10)", async () => {
		const { items } = buildTreeData([
			{ filename: "10.png", sizeBytes: 1 },
			{ filename: "2.png", sizeBytes: 2 },
			{ filename: "a.png", sizeBytes: 3 },
		])
		expect(items.root?.children).toEqual(["2.png", "10.png", "a.png"])
	})

	it("sorts folders before files, keeping natural order within each group", async () => {
		const { items } = buildTreeData([
			{ filename: "b.txt", sizeBytes: 1 },
			{ filename: "z/f.png", sizeBytes: 2 },
			{ filename: "10/d.png", sizeBytes: 3 },
			{ filename: "a/c.png", sizeBytes: 4 },
		])
		expect(items.root?.children).toEqual(["10", "a", "z", "b.txt"])
	})
})

describe("plugin-file FilePreviewPane", () => {
	const resolveFileUrl = vi.fn(
		(filename: string, size?: "preview" | "original") =>
			`/files/${filename}${size === "preview" ? "?size=preview" : ""}`,
	)

	it("renders the preview variant for images", () => {
		render(
			<FilePreviewPane
				filename="page.jpg"
				sizeBytes={42}
				resolveFileUrl={resolveFileUrl}
			/>,
		)
		const img = screen.getByTestId("file-preview-image")
		expect(img.getAttribute("src")).toBe("/files/page.jpg?size=preview")
	})

	it("renders a video player for video entries", () => {
		render(
			<FilePreviewPane
				filename="clip.mp4"
				sizeBytes={42}
				resolveFileUrl={resolveFileUrl}
			/>,
		)
		expect(screen.getByTestId("file-preview-video").getAttribute("src")).toBe(
			"/files/clip.mp4",
		)
	})

	it("resolves virtual archive paths with the same tokenized URL", () => {
		render(
			<FilePreviewPane
				filename="vol1.cbz!p01.jpg"
				sizeBytes={42}
				resolveFileUrl={resolveFileUrl}
			/>,
		)
		expect(screen.getByTestId("file-preview-image").getAttribute("src")).toBe(
			"/files/vol1.cbz!p01.jpg?size=preview",
		)
	})

	it("falls back to name and size for non-media files", () => {
		render(
			<FilePreviewPane
				filename="notes.txt"
				sizeBytes={7}
				resolveFileUrl={resolveFileUrl}
			/>,
		)
		expect(screen.getByText("notes.txt")).toBeTruthy()
		expect(screen.getByText("7.0 B")).toBeTruthy()
	})
})
