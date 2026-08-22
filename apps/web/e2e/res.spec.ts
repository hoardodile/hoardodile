import { expect, test } from "@playwright/test"
import { login } from "./helpers"

// 1x1 PNG used as the upload payload. Tiny so the staging step is fast.
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, "base64")

test.describe("resources create flow", () => {
	test.setTimeout(60_000)

	test("submit is disabled until staging completes", async ({ page }) => {
		await login(page)
		await page.goto("/resources/new")

		await expect(page.getByTestId("create-resource-submit")).toBeDisabled()

		await page.getByTestId("create-resource-files").setInputFiles({
			name: "pixel.png",
			mimeType: "image/png",
			buffer: TINY_PNG,
		})
		// Staging keeps the button disabled; it enables once every file is
		// fully staged into the pool.
		await expect(page.getByTestId("upload-staging-progress")).toHaveText(
			"1 / 1",
		)
		await expect(page.getByTestId("create-resource-submit")).toBeEnabled()
	})
})
