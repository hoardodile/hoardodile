import { expect, test } from "@playwright/test"
import { login } from "./helpers"

// 1x1 PNG used as the upload payload. Tiny so the staging step is fast.
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, "base64")

test.describe("footprint timeline", () => {
	test.setTimeout(60_000)

	test("an import appears on the /footprints page", async ({ page }) => {
		await login(page)

		const name = `trace-e2e-${Date.now()}`
		await page.goto("/resources/new")
		await page.getByTestId("create-resource-name").fill(name)
		await page.getByTestId("create-resource-files").setInputFiles({
			name: "pixel.png",
			mimeType: "image/png",
			buffer: TINY_PNG,
		})
		// The submit button stays disabled until the file is fully staged
		// into the pool; wait for staging, then for the success toast
		// (creation keeps the form open).
		await expect(page.getByTestId("upload-staging-progress")).toHaveText(
			"1 / 1",
		)
		await page.getByTestId("create-resource-submit").click()
		await expect(page.locator('[data-slot="toast"]')).toContainText("Created")

		await page.goto("/footprints")
		await expect(page.getByTestId("footprints-heading")).toBeVisible()
		await expect(page.getByText(`Imported ${name}`)).toBeVisible()
	})
})
