import { expect, test } from "@playwright/test"
import { expectShellRendered } from "./app-shell.ts"
import { appWindow, E2E_PASSWORD, launchDesktop } from "./launch.ts"

/**
 * Renderer-crash recovery (the desktop half of the "Something went wrong!"
 * work): a dead renderer process must surface the shell's in-window error
 * page with the localized crash message, and the Retry IPC (the same
 * `desktop:window:retry-load` channel the error page's button sends) must
 * bring the app window back — with the session intact.
 *
 * Playwright's page handle for a webContents dies with its renderer process
 * ("Target crashed") and never recovers, so everything after the crash is
 * asserted from the main process: the webContents URL, the session cookies,
 * and the retry IPC emitted on the real channel.
 *
 * Needs the packaged build: `pnpm -F @hoardodile/desktop package:dir` first.
 */
test("renderer crash → shell error page → Retry recovers", async () => {
	const harness = await launchDesktop()
	try {
		// Wizard → sidecar handoff → claim the unconfigured instance.
		const wizard = await harness.app.firstWindow()
		await expect(wizard.locator("input#library-path")).not.toHaveValue("")
		await wizard.getByTestId("wizard-continue").click()
		await expect
			.poll(() =>
				harness.app.windows().some((win) => win.url().startsWith(harness.url)),
			)
			.toBe(true)
		const appWin = appWindow(harness.app, harness.url)
		await expect(appWin.getByTestId("setup-submit")).toBeVisible({
			timeout: 120_000,
		})
		const fields = appWin.locator('input[type="password"]')
		await fields.nth(0).fill(E2E_PASSWORD)
		await fields.nth(1).fill(E2E_PASSWORD)
		await appWin.getByTestId("setup-submit").click()
		await expectShellRendered(appWin, { timeout: 120_000 })

		// Kill the renderer process from the main process — the crash path a
		// user hits when the renderer dies for real.
		await harness.app.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
		})

		// The shell error page (wizard bundle, ?mode=error) replaces the app
		// window and carries the localized crash message itself.
		await expect
			.poll(
				() =>
					harness.app.evaluate(
						({ BrowserWindow }) =>
							BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? "",
					),
				{ timeout: 60_000 },
			)
			.toContain("mode=error")
		const shellUrl = await harness.app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
		)
		expect(shellUrl).toContain("crashed")

		// Retry: emit on the real channel the error-page button uses. The
		// handler re-resolves the sidecar URL and reloads it.
		await harness.app.evaluate(({ ipcMain }) => {
			ipcMain.emit("desktop:window:retry-load")
		})
		await expect
			.poll(
				() =>
					harness.app.evaluate(
						({ BrowserWindow }) =>
							BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? "",
					),
				{ timeout: 120_000 },
			)
			.toContain(harness.url)

		// The session cookie survived the crash + retry cycle: reopening the
		// app lands on the claimed (signed-in) instance, not the setup form.
		const cookieNames = await harness.app.evaluate(
			async ({ session }, baseUrl) => {
				const cookies = await session.defaultSession.cookies.get({
					url: baseUrl,
				})
				return cookies.map((cookie) => cookie.name)
			},
			harness.url,
		)
		expect(cookieNames).toContain("app_session")
	} finally {
		await harness.close()
	}
})
