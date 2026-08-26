import { existsSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { expectShellRendered } from "./app-shell.ts"
import { appWindow, E2E_PASSWORD, launchDesktop } from "./launch.ts"

/**
 * The automated launch smoke (single spec, one desktop session):
 *
 *   1. wizard with the default library folder → continue (no native
 *      folder dialog involved — the default path is pre-filled);
 *   2. sidecar comes up, the wizard hands over to the app window;
 *   3. the unclaimed instance shows the setup form → set the password →
 *      the app sidebar appears; the bridge and `/health` are live (this
 *      proves the packaged native dependencies actually load, which the
 *      file-level verify-package checks cannot);
 *   4. close and relaunch on the same profile: no wizard, the session
 *      cookie survives, the library came back.
 */
test("first run → claim → relaunch persistence", async () => {
	const first = await launchDesktop()
	try {
		// 1. wizard: the library path defaults to Documents/hoardodile.
		const wizard = await first.app.firstWindow()
		await expect(wizard.locator("input#library-path")).not.toHaveValue("")
		await wizard.getByTestId("wizard-continue").click()

		// 2. sidecar handoff: an app window on http://127.0.0.1:<port>/.
		await expect
			.poll(() =>
				first.app.windows().some((win) => win.url().startsWith(first.url)),
			)
			.toBe(true)
		const appWin = appWindow(first.app, first.url)

		// 3. claim the instance through the real setup form; the claim lands
		// in the main shell (sidebar above the breakpoint, drawer button
		// below it — see apps/desktop/e2e/app-shell.ts).
		await expect(appWin.getByTestId("setup-submit")).toBeVisible({
			timeout: 120_000,
		})
		const fields = appWin.locator('input[type="password"]')
		await fields.nth(0).fill(E2E_PASSWORD)
		await fields.nth(1).fill(E2E_PASSWORD)
		await appWin.getByTestId("setup-submit").click()
		await expectShellRendered(appWin)

		// The preload bridge is the only thing that exists in the desktop
		// renderer; a browser tab would see `undefined`.
		expect(
			await appWin.evaluate(
				() =>
					(window as unknown as Record<string, unknown>).hoardodileDesktop !==
					undefined,
			),
		).toBe(true)

		// The sidecar is reachable and reports ok — natives loaded.
		const health = await fetch(`${first.url}health`)
		expect(health.ok).toBe(true)
		expect(await health.json()).toMatchObject({ ok: true })

		// Migrations ran against the chosen library (the wizard default is
		// Documents/hoardodile; HOARDODILE_E2E_DOCUMENTS pins Documents to
		// the throwaway dir); the config rounded-trip.
		expect(existsSync(join(first.libraryDir, "hoardodile", "app.sqlite"))).toBe(
			true,
		)
		expect(existsSync(join(first.userDataDir, "desktop.json"))).toBe(true)
	} finally {
		await first.close()
	}

	// 4. relaunch on the same profile: the wizard is done, the session
	// cookie survived, and the library is the same tree.
	const second = await launchDesktop({
		userDataDir: first.userDataDir,
		libraryDir: first.libraryDir,
		writeConfig: false,
	})
	try {
		await expect
			.poll(() =>
				second.app.windows().some((win) => win.url().startsWith(second.url)),
			)
			.toBe(true)
		const appWin = appWindow(second.app, second.url)
		await expectShellRendered(appWin, { timeout: 120_000 })
	} finally {
		await second.close()
	}
})
