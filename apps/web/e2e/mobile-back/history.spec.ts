import { expect, type Page, test } from "@playwright/test"

async function settled(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const fixture = Reflect.get(window, "mobileBackFixture")
				return fixture?.getState().pending
			}),
		)
		.toBe(false)
}
async function back(page: Page) {
	const position = await page.evaluate(
		() => window.history.state?.__hoardodileMobileBack?.position,
	)
	await page.evaluate(() => window.history.back())
	await expect
		.poll(() =>
			page.evaluate(
				() => window.history.state?.__hoardodileMobileBack?.position,
			),
		)
		.not.toBe(position)
	await settled(page)
}

test.beforeEach(async ({ page }) => {
	await page.goto("/one")
	await expect(
		page.getByRole("heading", { name: "History fixture" }),
	).toBeVisible()
	await page.getByRole("link", { name: "Two", exact: true }).click()
	await expect(page).toHaveURL(/\/two$/)
	await settled(page)
})

test("actual nested dialogs close child first and reopen after back", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Open nested", exact: true }).click()
	await settled(page)
	await back(page)
	await expect(page.getByTestId("child")).toHaveText("false")
	await expect(page.getByTestId("parent")).toHaveText("true")
	await page.getByRole("button", { name: "Open child", exact: true }).click()
	await settled(page)
	await page.getByRole("button", { name: "Close child", exact: true }).click()
	await settled(page)
	await back(page)
	await expect(page.getByTestId("parent")).toHaveText("false")
	for (let i = 0; i < 4; i++) {
		await page.getByRole("button", { name: "Open parent", exact: true }).click()
		await settled(page)
		await back(page)
		await expect(page.getByTestId("parent")).toHaveText("false")
	}
	await back(page)
	await expect(page).toHaveURL(/\/one$/)
})

test("menu-to-dialog handoff, forward tombstone tail, and normal route forward", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Menu", exact: true }).click()
	await page.getByRole("menuitem", { name: "Open from menu" }).click()
	await settled(page)
	await expect(page.getByTestId("parent")).toHaveText("true")
	await page.getByRole("button", { name: "Close parent", exact: true }).click()
	await settled(page)
	await page.evaluate(() => window.history.forward())
	await expect
		.poll(() =>
			page.evaluate(
				() => window.history.state?.__hoardodileMobileBack?.position,
			),
		)
		.toBe(2)
	await settled(page)
	await expect(page.getByTestId("parent")).toHaveText("false")
	await back(page)
	await expect(page).toHaveURL(/\/one$/)
	await page.evaluate(() => window.history.forward())
	await expect(page).toHaveURL(/\/two$/)
	await settled(page)
	await expect(page.getByTestId("parent")).toHaveText("false")
})

test("dirty overlay close does not confirm; route replacement does", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Toggle dirty" }).click()
	let confirms = 0
	page.on("dialog", async (dialog) => {
		confirms++
		await dialog.dismiss()
	})
	await page.getByRole("button", { name: "Open parent", exact: true }).click()
	await settled(page)
	await back(page)
	await expect(page.getByTestId("parent")).toHaveText("false")
	expect(confirms).toBe(0)
	await page.getByRole("button", { name: "Open parent", exact: true }).click()
	await settled(page)
	await page.evaluate(() =>
		Reflect.get(window, "mobileBackFixture").history.replace("/one"),
	)
	await expect.poll(() => confirms).toBe(1)
	await expect(page.getByTestId("parent")).toHaveText("true")
	await expect(page).toHaveURL(/\/two$/)
})

test("refresh on an open overlay leaves no extra back press", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Open parent", exact: true }).click()
	await settled(page)
	await page.reload()
	await expect(page.getByTestId("parent")).toHaveText("false")
	await settled(page)
	await back(page)
	await expect(page).toHaveURL(/\/one$/)
})

test("close then reopen while traversal is pending preserves the new dialog", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Open parent", exact: true }).click()
	await settled(page)
	await page
		.getByRole("button", { name: "Close and reopen", exact: true })
		.click()
	await settled(page)
	await expect(page.getByTestId("parent")).toHaveText("true")
	await expect(page.getByRole("dialog", { name: "Parent" })).toBeVisible()
	await back(page)
	await expect(page.getByTestId("parent")).toHaveText("false")
	await expect(page).toHaveURL(/\/two$/)
})

test("route replacement never restores the replaced URL through a forward overlay slot", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Open parent", exact: true }).click()
	await settled(page)
	await page.evaluate(() =>
		Reflect.get(window, "mobileBackFixture").history.replace("/"),
	)
	await expect(page).toHaveURL(/\/$/)
	await settled(page)
	await page.evaluate(() => window.history.forward())
	await expect
		.poll(() =>
			page.evaluate(
				() => window.history.state?.__hoardodileMobileBack?.position,
			),
		)
		.toBe(2)
	await settled(page)
	await expect(page).toHaveURL(/\/$/)
	await expect(page.getByTestId("parent")).toHaveText("false")
})

test("host breakpoint controls a narrow plugin frame and re-arms open overlays", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.getByRole("button", { name: "Toggle frame", exact: true }).click()
	const frame = page.frameLocator("iframe")
	await frame.getByRole("button", { name: "Plugin dialog" }).click()
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mobileBackFixture").getState().overlays.length,
			),
		)
		.toBe(1)
	await settled(page)
	expect(
		await page.evaluate(
			() => window.history.state?.__hoardodileMobileBack?.position,
		),
	).toBe(1)
	await page.setViewportSize({ width: 390, height: 844 })
	await expect
		.poll(() =>
			page.evaluate(
				() => window.history.state?.__hoardodileMobileBack?.position,
			),
		)
		.toBe(2)
	await back(page)
	await expect(frame.getByTestId("plugin-open")).toHaveText("false")
	await expect(page).toHaveURL(/\/two$/)
})

test("sandbox plugin and host overlays share back order and released frames leave no registration", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Toggle frame", exact: true }).click()
	const frame = page.frameLocator("iframe")
	await frame.getByRole("button", { name: "Plugin dialog" }).click()
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mobileBackFixture").getState().overlays.length,
			),
		)
		.toBe(1)
	await page.getByRole("button", { name: "Open parent", exact: true }).click()
	await settled(page)
	await back(page)
	await expect(page.getByTestId("parent")).toHaveText("false")
	await expect(frame.getByTestId("plugin-open")).toHaveText("true")
	await back(page)
	await expect(frame.getByTestId("plugin-open")).toHaveText("false")
	await frame.getByRole("button", { name: "Plugin dialog" }).click()
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					Reflect.get(window, "mobileBackFixture").getState().overlays.length,
			),
		)
		.toBe(1)
	await page.getByRole("button", { name: "Toggle frame", exact: true }).click()
	await settled(page)
	await back(page)
	await expect(page).toHaveURL(/\/one$/)
})
