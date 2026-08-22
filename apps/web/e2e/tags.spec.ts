import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test.describe("tags integration on create pages", () => {
	test.setTimeout(60_000)

	test("character /new page renders the tag picker", async ({ page }) => {
		await login(page)
		await page.goto("/characters/new")
		await expect(page.getByTestId("create-character-tags")).toBeVisible()
	})

	test("resource /new page renders the tag picker", async ({ page }) => {
		await login(page)
		await page.goto("/resources/new")
		await expect(page.getByTestId("create-resource-tags")).toBeVisible()
	})
})
