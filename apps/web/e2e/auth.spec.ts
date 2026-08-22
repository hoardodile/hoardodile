import { expect, test } from "@playwright/test"

const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ""
const ROTATED_PASSWORD = `${PASSWORD}-rotated`

// The instance is claimed by the `setup` project (e2e/claim.setup.ts), so
// every test here runs against a configured server.
test.describe("auth flow", () => {
	test("rejects the wrong password and keeps the user on /login", async ({
		page,
	}) => {
		await page.goto("/")
		await expect(page).toHaveURL(/\/login$/)
		await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible()

		await page.getByLabel(/password/i).fill("definitely-wrong")
		await page.getByTestId("login-submit").click()

		const error = page.getByRole("alert")
		await expect(error).toBeVisible()
		await expect(error).toContainText(/incorrect/i)
		await expect(page).toHaveURL(/\/login$/)
	})

	test("accepts the correct password and lands on /", async ({ page }) => {
		expect(
			PASSWORD,
			"E2E_TEST_PASSWORD must be set by the Playwright config",
		).not.toBe("")

		await page.goto("/")
		await expect(page).toHaveURL(/\/login$/)

		await page.getByLabel(/password/i).fill(PASSWORD)
		await page.getByTestId("login-submit").click()

		await expect(page.getByTestId("app-sidebar")).toBeVisible()
		await expect(page).toHaveURL("/")
	})

	test("changes the password from the settings page and signs back in", async ({
		page,
	}) => {
		await page.goto("/")
		await expect(page).toHaveURL(/\/login$/)
		await page.getByLabel(/password/i).fill(PASSWORD)
		await page.getByTestId("login-submit").click()
		await expect(page.getByTestId("app-sidebar")).toBeVisible()

		await page.goto("/settings")
		await page.getByTestId("change-password").click()
		await expect(page.getByTestId("change-password-dialog")).toBeVisible()

		await page.getByLabel("Current password", { exact: true }).fill(PASSWORD)
		await page
			.getByLabel("New password", { exact: true })
			.fill(ROTATED_PASSWORD)
		await page
			.getByLabel("Confirm new password", { exact: true })
			.fill(ROTATED_PASSWORD)
		await page.getByTestId("password-save").click()

		// The dialog closes on success.
		await expect(page.getByTestId("change-password-dialog")).toBeHidden()

		// The old password no longer works; the new one does.
		await page.context().clearCookies()
		await page.goto("/login")
		await page.getByLabel(/password/i).fill(PASSWORD)
		await page.getByTestId("login-submit").click()
		await expect(page.getByRole("alert")).toBeVisible()
		await expect(page).toHaveURL(/\/login$/)

		await page.getByLabel(/password/i).fill(ROTATED_PASSWORD)
		await page.getByTestId("login-submit").click()
		await expect(page.getByTestId("app-sidebar")).toBeVisible()

		// Rotate back so the shared E2E_TEST_PASSWORD stays valid for the
		// remaining spec files.
		await page.goto("/settings")
		await page.getByTestId("change-password").click()
		await expect(page.getByTestId("change-password-dialog")).toBeVisible()
		await page
			.getByLabel("Current password", { exact: true })
			.fill(ROTATED_PASSWORD)
		await page.getByLabel("New password", { exact: true }).fill(PASSWORD)
		await page
			.getByLabel("Confirm new password", { exact: true })
			.fill(PASSWORD)
		await page.getByTestId("password-save").click()
		await expect(page.getByTestId("change-password-dialog")).toBeHidden()
	})
})
