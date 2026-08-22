import { render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppDialog } from "./app-dialog"
import { ImageCropPanel } from "./image-crop-panel"

const TALL_IMAGE_SRC =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1000' height='2000'%3E%3Crect width='100%25' height='100%25' fill='red'/%3E%3C/svg%3E"

describe("ImageCropPanel", () => {
	it("constrains the image within the provided crop stage bounds", async () => {
		render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				initialSrc={TALL_IMAGE_SRC}
				cropStageWidth={260}
				cropStageHeight={500}
				hideActionButton
				onSave={vi.fn()}
			/>,
		)

		const img = await screen.findByRole("img")
		expect(img).toHaveStyle({
			"max-width": "260px",
			"max-height": "500px",
		})
	})

	it("uses default bounds when crop stage dimensions are omitted", async () => {
		render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				initialSrc={TALL_IMAGE_SRC}
				hideActionButton
				onSave={vi.fn()}
			/>,
		)

		const img = await screen.findByRole("img")
		expect(img).toHaveStyle({
			"max-width": "320px",
			"max-height": "240px",
		})
	})

	it("keeps the crop stage wrapper within the effective bounds", async () => {
		const { container } = render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				initialSrc={TALL_IMAGE_SRC}
				cropStageWidth={200}
				cropStageHeight={200}
				hideActionButton
				onSave={vi.fn()}
			/>,
		)

		const stage = container.querySelector("[data-testid='image-crop-frame']")
		expect(stage).toBeNull()

		const wrapper = container.querySelector(
			".overflow-hidden.rounded-md.border",
		)
		await waitFor(() => expect(wrapper).toBeInTheDocument())
		expect(wrapper).toHaveStyle({
			width: "200px",
			height: "200px",
			"max-width": "200px",
			"max-height": "200px",
		})
	})

	it("does not render the live preview when hidden", async () => {
		render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				initialSrc={TALL_IMAGE_SRC}
				hideActionButton
				hidePreview
				onSave={vi.fn()}
			/>,
		)

		await screen.findByRole("img")
		expect(screen.queryByTestId("image-crop-preview")).not.toBeInTheDocument()
	})

	it("stretches the stage to fill its parent width when filling", async () => {
		const { container } = render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				initialSrc={TALL_IMAGE_SRC}
				cropStageWidth={13}
				cropStageHeight={25}
				hideActionButton
				fillWidth
				onSave={vi.fn()}
			/>,
		)

		const img = await screen.findByRole("img")
		expect(img).toHaveStyle({ "max-width": "100%" })

		const wrapper = container.querySelector(
			".overflow-hidden.rounded-md.border",
		)
		await waitFor(() => expect(wrapper).toBeInTheDocument())
		expect(wrapper).toHaveStyle({ "aspect-ratio": "13 / 25" })
		expect(wrapper).not.toHaveStyle({ width: "13px" })
		expect(wrapper?.parentElement).toHaveClass("w-full")
	})

	it("renders the save button on the same footer row as the dialog's cancel", async () => {
		render(
			<AppDialog
				open
				title="Cover"
				onOpenChange={() => {}}
				footer={
					<button type="button" data-testid="dialog-cancel">
						Cancel
					</button>
				}
			>
				<ImageCropPanel
					labels={{
						saving: "Saving",
						remove: "Remove",
						save: "Save",
						pickHint: "Click or drop",
						reselect: "Re-upload",
						previewLabel: "Preview",
						previewAlt: "Cropped preview",
						showPreview: "Show preview",
						saveFailed: "Save failed",
					}}
					initialSrc={TALL_IMAGE_SRC}
					onSave={vi.fn()}
				/>
			</AppDialog>,
		)

		await screen.findByRole("img")
		// The dialog renders into a portal, so the footer lives on the
		// document rather than the render container.
		const footer = document.querySelector('[data-slot="dialog-footer"]')
		expect(footer).not.toBeNull()
		// The panel contributes its action through DialogFooterActions, so
		// save and cancel share the dialog's footer row.
		expect(
			within(footer as HTMLElement).getByTestId("image-crop-save"),
		).toHaveTextContent("Save")
		expect(
			within(footer as HTMLElement).getByTestId("dialog-cancel"),
		).toBeInTheDocument()
	})

	it("renders the action button as an inline panel row outside a dialog", () => {
		const { container } = render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				onClear={vi.fn()}
				onSave={vi.fn()}
			/>,
		)

		expect(screen.getByTestId("image-crop-frame")).toBeInTheDocument()
		// No image selected: the action button becomes "Remove".
		const remove = screen.getByTestId("image-crop-save")
		expect(remove).toHaveTextContent("Remove")
		expect(container.querySelector('[data-slot="dialog-footer"]')).toBeNull()
	})

	it("hides the action button when hideActionButton is set", async () => {
		render(
			<ImageCropPanel
				labels={{
					saving: "Saving",
					remove: "Remove",
					save: "Save",
					pickHint: "Click or drop",
					reselect: "Re-upload",
					previewLabel: "Preview",
					previewAlt: "Cropped preview",
					showPreview: "Show preview",
					saveFailed: "Save failed",
				}}
				initialSrc={TALL_IMAGE_SRC}
				hideActionButton
				onSave={vi.fn()}
			/>,
		)

		await screen.findByRole("img")
		expect(screen.queryByTestId("image-crop-save")).not.toBeInTheDocument()
	})
})
