import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { renderWithI18n } from "../test/i18n"

const TALL_IMAGE_SRC =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1000' height='2000'%3E%3Crect width='100%25' height='100%25' fill='red'/%3E%3C/svg%3E"

// This suite exercises the PUBLISHED bundle (`dist/`), not `src/`. The
// `DialogFooterActions` routing relies on a single React context shared by
// `AppDialog` (the provider) and `ImageCropPanel` (the consumer). With
// `splitting: false` (see tsup.config.ts) tsup inlines that shared module into
// every entry, so the dist carries TWO copies of the context and production
// bundles give the provider and consumer different instances — the crop action
// then falls back to an inline row instead of the dialog footer. When the
// package has not been built there is no dist to test, so skip gracefully.
const distAppDialog = resolve(process.cwd(), "dist/components/app-dialog.js")
const built = existsSync(distAppDialog)

describe.skipIf(!built)("ImageCropPanel (production dist)", () => {
	it("lands the crop action on the same dialog footer row as cancel", async () => {
		const { AppDialog } = await import("../../dist/components/app-dialog")
		const { ImageCropPanel } = await import("../../dist/components/image-crop-panel")

		renderWithI18n(
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
				<ImageCropPanel initialSrc={TALL_IMAGE_SRC} onSave={vi.fn()} />
			</AppDialog>,
		)

		await screen.findByRole("img")
		const footer = document.querySelector('[data-slot="dialog-footer"]')
		expect(footer).not.toBeNull()
		// The crop action must be contributed into the SAME footer row as
		// cancel — this is what breaks when the dist duplicates the
		// `DialogFooterActionsContext` across entries.
		expect(
			within(footer as HTMLElement).getByTestId("image-crop-save"),
		).toBeInTheDocument()
		expect(
			within(footer as HTMLElement).getByTestId("dialog-cancel"),
		).toBeInTheDocument()
	})
})
