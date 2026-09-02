import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ImageEditPanel } from "./ImageEditPanel"

// A tiny valid 1x1 GIF so the preloaded image renders without an onload
// dependency for the assertions below.
const TINY_GIF =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

function renderPanel(
	overrides: Partial<Parameters<typeof ImageEditPanel>[0]> = {},
) {
	const props = {
		mimeType: "image/png" as const,
		cropStageWidth: 280,
		cropStageHeight: 280,
		onSave: vi.fn(async () => {}),
		deleteUrl: "/api/resources/r1/cover",
		onInvalidate: vi.fn(async () => {}),
		deleteTestId: "confirm-delete-btn",
		removeTestId: "remove-btn",
		...overrides,
	}
	return render(
		<AppDialog
			open
			title="Edit cover"
			onOpenChange={() => {}}
			footer={
				<button type="button" data-testid="cancel-btn">
					Cancel
				</button>
			}
		>
			<ImageEditPanel {...props} />
		</AppDialog>,
	)
}

describe("ImageEditPanel", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("renders an icon-free danger Remove button at the footer's left edge when a current image is preloaded", async () => {
		renderPanel({ initialSrc: TINY_GIF })
		const removeBtn = await screen.findByTestId("remove-btn")
		expect(removeBtn).toHaveTextContent("Remove")
		// Single-purpose danger button — no icon glyph.
		expect(removeBtn.querySelector("svg")).toBeNull()
	})

	it("hides the Remove button when no image is preloaded", () => {
		renderPanel()
		expect(screen.queryByTestId("remove-btn")).not.toBeInTheDocument()
	})

	it("hides the Remove button when there is nothing to delete", () => {
		renderPanel({
			initialSrc: TINY_GIF,
			deleteUrl: undefined,
			onInvalidate: undefined,
		})
		expect(screen.queryByTestId("remove-btn")).not.toBeInTheDocument()
	})

	it("opens the delete confirmation when the Remove button is clicked", async () => {
		renderPanel({ initialSrc: TINY_GIF })
		expect(await screen.findByTestId("remove-btn")).toBeInTheDocument()
		fireEvent.click(screen.getByTestId("remove-btn"))
		expect(await screen.findByTestId("confirm-delete-btn")).toBeInTheDocument()
	})

	it("renders the Remove button to the left of Cancel (left-edge function key)", async () => {
		renderPanel({ initialSrc: TINY_GIF })
		const removeBtn = await screen.findByTestId("remove-btn")
		const cancelBtn = screen.getByTestId("cancel-btn")
		expect(
			removeBtn.compareDocumentPosition(cancelBtn) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
	})

	it("keeps the primary Save enabled and labeled 'Save' when an image is present", async () => {
		renderPanel({ initialSrc: TINY_GIF })
		const save = await screen.findByTestId("image-crop-save")
		expect(save).toHaveTextContent("Save")
		expect(save).toBeEnabled()
	})

	it("places Remove after Cancel when there is no primary action (2-button footer)", async () => {
		renderPanel({ initialSrc: TINY_GIF, hideActionButton: true })
		const removeBtn = await screen.findByTestId("remove-btn")
		const cancelBtn = screen.getByTestId("cancel-btn")
		expect(
			cancelBtn.compareDocumentPosition(removeBtn) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
	})

	it("calls the DELETE endpoint on the confirm action", async () => {
		const deleteMock = vi.fn(
			async () => new Response("", { status: 200, headers: {} }),
		)
		vi.stubGlobal("fetch", deleteMock)
		renderPanel({ initialSrc: TINY_GIF })

		const removeBtn = await screen.findByTestId("remove-btn")
		fireEvent.click(removeBtn)
		const confirmBtn = await screen.findByTestId("confirm-delete-btn")
		fireEvent.click(confirmBtn)

		await waitFor(() =>
			expect(deleteMock).toHaveBeenCalledWith(
				"/api/resources/r1/cover",
				expect.objectContaining({
					method: "DELETE",
					credentials: "include",
				}),
			),
		)
	})
})
