import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test("complete backup, confirmed restore, and manual device management", async ({
	page,
}, testInfo) => {
	test.setTimeout(180_000)
	await page.setViewportSize({ width: 1600, height: 900 })
	await login(page)
	await page.goto("/settings/backups")
	await expect(page.getByTestId("complete-backups")).toBeVisible()
	await page.getByTestId("initialize-backups").click()
	const point = page.locator('[data-testid^="recovery-point-"]').first()
	await expect(point).toBeVisible({ timeout: 90_000 })
	await page.screenshot({
		path: testInfo.outputPath("complete-backups.png"),
		fullPage: true,
	})
	await point.getByRole("button", { name: "Restore", exact: true }).click()
	const confirmation = page.getByTestId("full-restore-confirm")
	await expect(confirmation).toBeVisible({ timeout: 30_000 })
	await confirmation.fill("wrong")
	await expect(page.getByTestId("full-restore-submit")).toBeDisabled()
	await confirmation.fill("RESTORE")
	await page.getByTestId("full-restore-submit").click()
	await expect(page.getByTestId("library-maintenance")).toBeVisible({
		timeout: 15_000,
	})
	await expect(page.getByTestId("library-maintenance")).not.toBeVisible({
		timeout: 90_000,
	})
	await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30_000 })
	await page.goto("/settings/sync")
	await expect(page.getByTestId("backup-sync")).toBeVisible()
	await page.getByTestId("sync-device-add").click()
	await page
		.getByRole("dialog")
		.getByRole("textbox", { name: "Name", exact: true })
		.fill("Manual laptop")
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Save", exact: true })
		.click()
	await expect(page.getByText("Manual laptop", { exact: true })).toBeVisible()
	await expect(page.getByText("Manual record", { exact: true })).toBeVisible()
	await page.screenshot({
		path: testInfo.outputPath("backup-sync.png"),
		fullPage: true,
	})
})
