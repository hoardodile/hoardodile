import { expect, test as setup } from "@playwright/test"

const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ""

// The first navigation of a run pays for the vite dev cold start (dep
// optimization + first transform of the whole module graph), which can
// approach the default 30s test timeout on slower machines — allow it.
setup.setTimeout(180_000)

/**
 * First-run claim, run once before every spec file (project dependency).
 * The e2e storage is wiped per run, so the server boots unconfigured; this
 * setup project claims it through the real web setup form so the main
 * specs only ever deal with a configured instance. Alphabetical file order
 * and worker count are deliberately not relied upon.
 */
setup(
	"claim the unconfigured instance via the web setup form",
	async ({ page }) => {
		expect(
			PASSWORD,
			"E2E_TEST_PASSWORD must be set by the Playwright config",
		).not.toBe("")

		await page.goto("/", { timeout: 120_000 })
		await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 })
		await expect(
			page.getByRole("heading", { name: /set a password/i }),
		).toBeVisible()

		const fields = page.locator('input[type="password"]')
		await fields.nth(0).fill(PASSWORD)
		await fields.nth(1).fill(PASSWORD)
		await page.getByTestId("setup-submit").click()

		await expect(page.getByTestId("app-sidebar")).toBeVisible()
		await expect(page).toHaveURL("/")
	},
)
