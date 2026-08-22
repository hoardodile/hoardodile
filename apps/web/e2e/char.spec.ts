import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test.describe("characters create flow", () => {
	test.setTimeout(60_000)

	test("create with explicit name lands on detail page", async ({ page }) => {
		await login(page)

		await page.goto("/characters")
		await page.getByTestId("new-character").click()
		await expect(page).toHaveURL(/\/characters\/new$/)

		const name = `e2e-${Date.now()}`
		await page.getByTestId("create-character-name").fill(name)
		await page.getByTestId("create-character-intro").fill("hello")
		await page.getByTestId("create-character-submit").click()

		await expect(page).toHaveURL(/\/characters\/[^/]+$/)
		await expect(page.getByTestId("character-detail-name")).toHaveText(name)
	})

	test("create is disabled until a name is entered", async ({ page }) => {
		await login(page)
		await page.goto("/characters/new")

		const submit = page.getByTestId("create-character-submit")
		await expect(submit).toBeDisabled()

		await page.getByTestId("create-character-name").fill(`e2e-${Date.now()}`)
		await expect(submit).toBeEnabled()
	})
})
