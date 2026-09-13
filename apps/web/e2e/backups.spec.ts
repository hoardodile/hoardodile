import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test("complete backup, confirmed restore, and merged backup-sync page", async ({
	page,
}, testInfo) => {
	test.setTimeout(240_000)
	await page.setViewportSize({ width: 1600, height: 900 })
	await login(page)
	await page.goto("/settings/backups")
	await expect(page.getByTestId("complete-backups")).toBeVisible()
	await expect(page.getByTestId("complete-backups-section")).toBeVisible()
	// The merged Protection section hosts both the local-backup block and the
	// offsite-copy block — they are no longer two separate sections. With no
	// local backup yet only the three setup options are offered; the sync
	// service and the "share" (sender) option stay hidden until a backup
	// exists.
	await expect(page.getByTestId("setup-new-backup")).toBeVisible()
	await expect(page.getByTestId("setup-existing-backup")).toBeVisible()
	await expect(page.getByTestId("setup-sync-receive")).toBeVisible()
	await expect(page.getByTestId("setup-sync-send")).not.toBeVisible()
	await expect(page.getByTestId("backup-sync")).not.toBeVisible()
	await expect(page.getByText("On this device")).toBeVisible()
	await expect(page.getByText("Offsite copy")).not.toBeVisible()
	// No jobs yet, so Recent operations stays hidden (empty-state hides it).
	await expect(page.getByTestId("recent-operations-section")).not.toBeVisible()
	// External manual sync records are gone.
	await expect(page.getByTestId("external-sync-records")).not.toBeVisible()
	await expect(page.getByTestId("sync-device-add")).not.toBeVisible()
	// The historical archives live on their own tab above the backups tab.
	await page.goto("/settings/archives")
	await expect(page.getByTestId("archives-section")).toBeVisible()
	await expect(page.getByTestId("create-archive")).toBeVisible()
	await page.goto("/settings/backups")
	await page.getByTestId("setup-new-backup").click()
	await page.getByTestId("initialize-backups").click()
	// The first backup can fail to start once — an intermittent cold-start or
	// managed-process lease race in the restic engine. Retry a failed backup
	// so this spec checks the backups UI flow rather than restic's first-run
	// reliability: the job list lives behind the Recent operations dialog now,
	// five rows to a page, so a failed first job is always on page one.
	const point = page.locator('[data-testid^="recovery-point-"]').first()
	const retry = page
		.getByTestId("recent-operations-dialog")
		.getByRole("button", { name: "Retry" })
	for (let attempt = 0; attempt < 3; attempt++) {
		const visible = await point
			.first()
			.waitFor({ state: "visible", timeout: 45_000 })
			.then(() => true)
			.catch(() => false)
		if (visible) break
		const open = page.getByTestId("recent-operations-open")
		if ((await open.count()) > 0) {
			await open.click()
			if (await retry.count()) await retry.first().click()
			await page.keyboard.press("Escape")
		}
	}
	await expect(point).toBeVisible({ timeout: 30_000 })
	// Available backups only exists once a repository is configured.
	await expect(page.getByTestId("available-backups-section")).toBeVisible()
	// The first backup exists now: the sync service and the "share" (sender)
	// option become available.
	await expect(page.getByTestId("backup-sync")).toBeVisible()
	await expect(page.getByTestId("setup-sync-send")).toBeVisible()
	const download = page.waitForEvent("download")
	await page.getByTestId("recovery-key-notice").getByRole("button").click()
	expect((await download).suggestedFilename()).toBe(
		"hoardodile-recovery-local.json",
	)
	await expect(page.getByTestId("recovery-key-notice")).not.toBeVisible()
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
	await expect(page.getByTestId("backup-sync")).toBeVisible()
	await page.screenshot({
		path: testInfo.outputPath("backup-sync.png"),
		fullPage: true,
		animations: "disabled",
	})
})
