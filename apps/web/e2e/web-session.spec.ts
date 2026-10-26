import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, expect, type Page, test } from "@playwright/test"

const PASSWORD = process.env.E2E_TEST_PASSWORD ?? ""
test.setTimeout(90_000)

async function enterPassword(page: Page, action: "login" | "unlock") {
	await expect(page.getByTestId(`${action}-submit`)).toBeVisible()
	await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
	await page.getByTestId(`${action}-submit`).click()
	await expect(page.getByTestId("app-sidebar")).toBeVisible()
}

async function enablePageSession(page: Page) {
	await page.goto("/settings/web")
	await page.getByTestId("web-requireUnlock-switch").click()
	await expect(page.getByTestId("web-requireUnlock-switch")).toBeChecked()
}

test("unlocking returns to the remembered page in every tab; explicit sign-out returns to login", async ({
	page,
	context,
}) => {
	await page.goto("/")
	await enterPassword(page, "login")
	await enablePageSession(page)
	// Locking is idempotent: a page opened while already locked is not
	// adopted as the return destination, so unlocking lands on the page the
	// session was last remembered at.
	await page.goto("/documents")
	await expect(page).toHaveURL(/\/unlock$/)
	await enterPassword(page, "unlock")
	await expect(page).toHaveURL(/\/settings\/web$/)
	await page.reload()
	await expect(page).toHaveURL(/\/unlock$/)
	await page.getByLabel("Password", { exact: true }).fill("wrong")
	await page.getByTestId("unlock-submit").click()
	await expect(page.getByRole("alert")).toBeVisible()
	await enterPassword(page, "unlock")
	await expect(page).toHaveURL(/\/settings\/web$/)

	// An in-app navigation into content replaces the remembered page.
	await page.getByRole("link", { name: "Resources" }).click()
	await expect(page).toHaveURL(/\/resources$/)

	const other = await context.newPage()
	await other.goto("/settings")
	await expect(other).toHaveURL(/\/unlock$/)
	await expect(page).toHaveURL(/\/resources$/)
	await enterPassword(other, "unlock")
	// Tabs share the remembered page, so this locked deep link unlocks there
	// too and leaves the unlocked tab where it already is.
	await expect(other).toHaveURL(/\/resources$/)
	await expect(page).toHaveURL(/\/resources$/)
	await other.getByRole("link", { name: "Settings" }).first().click()
	await other.getByTestId("sign-out").click()
	await expect(other).toHaveURL(/\/login$/)
	await expect(page).toHaveURL(/\/resources$/)
	await page.reload()
	await expect(page).toHaveURL(/\/unlock$/)
	await enterPassword(other, "login")
	await expect(other).toHaveURL("/")
})

test("restarting a browser with the same profile preserves only unlock continuity", async ({
	baseURL,
}) => {
	if (!baseURL) throw new Error("Missing test base URL")
	const profile = mkdtempSync(join(tmpdir(), "hoardodile-browser-session-"))
	let context = await chromium.launchPersistentContext(profile, {
		headless: true,
		baseURL,
		viewport: { width: 1280, height: 900 },
	})
	try {
		const page = await context.newPage()
		await page.goto("/")
		await enterPassword(page, "login")
		await enablePageSession(page)
		await page.reload()
		await enterPassword(page, "unlock")
		await expect(page).toHaveURL(/\/settings\/web$/)
		await context.close()
		context = await chromium.launchPersistentContext(profile, {
			headless: true,
			baseURL,
			viewport: { width: 1280, height: 900 },
		})
		const reopened = await context.newPage()
		await reopened.goto("/")
		await expect(reopened).toHaveURL(/\/unlock$/)
		await enterPassword(reopened, "unlock")
		await expect(reopened).toHaveURL(/\/settings\/web$/)
	} finally {
		await context.close()
		rmSync(profile, { recursive: true, force: true })
	}
})
