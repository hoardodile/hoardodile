import { expect, type Page } from "@playwright/test"

const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ""

/**
 * Sign in to the app. Tolerant of the first-run state: when the server is
 * still unclaimed, the login page shows the web setup form instead, and
 * claiming it with the same password signs us in.
 */
export async function login(page: Page) {
	expect(PASSWORD, "E2E_TEST_PASSWORD must be set by the config").not.toBe("")
	// Generous timeout: the first spec of a run can still be inside the
	// vite dev cold-start window (see claim.setup.ts).
	await page.goto("/", { timeout: 120_000 })
	// Fresh-context boots can outlast the 5s default (state after the
	// claim/cold-start window); 30s is the suite's standard timeout cap.
	await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 })
	const fields = page.locator('input[type="password"]')
	const setupButton = page.getByTestId("setup-submit")
	if ((await setupButton.count()) > 0) {
		await fields.nth(0).fill(PASSWORD)
		await fields.nth(1).fill(PASSWORD)
		await setupButton.click()
	} else {
		await fields.first().fill(PASSWORD)
		await page.getByTestId("login-submit").click()
	}
	await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible()
}
