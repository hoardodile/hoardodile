import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { expectShellRendered } from "./app-shell.ts"
import { appWindow, E2E_PASSWORD, launchDesktop } from "./launch.ts"

test("window reopen and full restart unlock the original page; explicit sign-out requires login", async () => {
	const first = await launchDesktop()
	console.info(`desktop test profile: ${first.userDataDir}`)
	console.info(`desktop test library: ${join(first.libraryDir, "hoardodile")}`)
	const target = "/settings/desktop"
	try {
		const wizard = await first.app.firstWindow()
		await wizard.getByTestId("wizard-continue").click()
		await expect
			.poll(
				() =>
					first.app.windows().some((page) => page.url().startsWith(first.url)),
				{ timeout: 60_000 },
			)
			.toBe(true)
		const page = appWindow(first.app, first.url)
		await expect(page.getByTestId("setup-submit")).toBeVisible({
			timeout: 120_000,
		})
		const fields = page.locator('input[type="password"]')
		await fields.nth(0).fill(E2E_PASSWORD)
		await fields.nth(1).fill(E2E_PASSWORD)
		await page.getByTestId("setup-submit").click()
		await expectShellRendered(page)
		await page.goto(`${first.url.replace(/\/$/, "")}${target}`)
		await page.evaluate(async () => {
			const bridge = window.hoardodileDesktop
			if (!bridge) throw new Error("Missing desktop bridge")
			await bridge.setConfig({
				requireSignInOnLaunch: true,
				requireSignInOnWindowOpen: true,
			})
			await bridge.setCloseAction("tray")
		})
		await expect
			.poll(() => {
				const config = JSON.parse(
					readFileSync(join(first.userDataDir, "desktop.json"), "utf8"),
				)
				return (
					config.closeAction === "tray" &&
					config.requireSignInOnLaunch === true &&
					config.requireSignInOnWindowOpen === true &&
					config.authContexts?.[config.libraryPath]?.href === target
				)
			})
			.toBe(true)
		await first.app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.close(),
		)
		await expect.poll(() => first.app.windows().length).toBe(0)
		// This is the main-process reopen handler used by a second launch.
		await first.app.evaluate(({ app }) => {
			app.emit("second-instance", {}, [])
		})
		await expect
			.poll(() =>
				first.app
					.windows()
					.some((window) => window.url().startsWith(first.url)),
			)
			.toBe(true)
		const reopened = appWindow(first.app, first.url)
		await expect(reopened.getByTestId("unlock-heading")).toBeVisible()
		await reopened.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD)
		await reopened.getByTestId("unlock-submit").click()
		await expect(reopened).toHaveURL(new RegExp(`${target}$`))
		await expect(reopened.getByTestId("me-tab-web")).toHaveCount(0)
	} finally {
		await first.close()
	}

	// Simulate an upgrade from a profile that predates authContexts.
	const configFile = join(first.userDataDir, "desktop.json")
	const legacyConfig: Record<string, unknown> = JSON.parse(
		readFileSync(configFile, "utf8"),
	)
	delete legacyConfig.authContexts
	writeFileSync(configFile, JSON.stringify(legacyConfig, null, "\t"))
	const second = await launchDesktop({
		userDataDir: first.userDataDir,
		libraryDir: first.libraryDir,
		writeConfig: false,
	})
	try {
		await expect
			.poll(() =>
				second.app.windows().some((page) => page.url().startsWith(second.url)),
			)
			.toBe(true)
		const page = appWindow(second.app, second.url)
		await expect(page.getByTestId("unlock-heading")).toBeVisible()
		await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD)
		await page.getByTestId("unlock-submit").click()
		await expect(page).toHaveURL(new RegExp(`${target}$`))
		// Reproduce the narrow Windows CI display even on wider local screens.
		await second.app.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.setSize(1024, 720)
		})
		await expect(
			page.getByRole("tab", { name: "Preferences", exact: true }),
		).toBeVisible()
		await page
			.getByTestId("me-tab-preferences")
			.filter({ visible: true })
			.click()
		await page.getByTestId("sign-out").click()
		await expect(page.getByTestId("login-submit")).toBeVisible()
	} finally {
		await second.close()
	}

	const third = await launchDesktop({
		userDataDir: first.userDataDir,
		libraryDir: first.libraryDir,
		writeConfig: false,
	})
	try {
		await expect
			.poll(() =>
				third.app.windows().some((page) => page.url().startsWith(third.url)),
			)
			.toBe(true)
		const page = appWindow(third.app, third.url)
		await expect(page.getByTestId("login-submit")).toBeVisible()
		await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD)
		await page.getByTestId("login-submit").click()
		await expectShellRendered(page)
		await expect(page).toHaveURL(third.url)
	} finally {
		await third.close()
	}
})
