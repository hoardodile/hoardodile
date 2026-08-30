import { expect, type Page, test } from "@playwright/test"
import { login } from "./helpers"

type UpdateState = Record<string, unknown> & { readonly status: string }

/**
 * Install a controllable mock desktop bridge before the SPA loads, so the
 * Electron-only update UI (banner row, About dot, menu-button dot, apply
 * overlay) is exercised in a real browser. The update state can be flipped
 * at runtime via `window.__setUpdateState`.
 */
async function installDesktopBridge(page: Page, initialState: UpdateState) {
	await page.addInitScript((state) => {
		const listeners = new Set<(next: UpdateState) => void>()
		let current = state as UpdateState & { status: string }
		;(window as unknown as Record<string, unknown>).__setUpdateState = (
			next: UpdateState & { status: string },
		) => {
			current = next
			for (const listener of listeners) listener(next)
		}
		;(window as unknown as Record<string, unknown>).hoardodileDesktop = {
			isDesktop: true,
			platform: "desktop",
			minimize() {},
			toggleMaximize() {},
			close() {},
			retryLoad() {},
			toggleDevtools() {},
			async isMaximized() {
				return false
			},
			onMaximizedChange() {
				return () => undefined
			},
			updates: {
				portable: false,
				async status() {
					return current
				},
				onStatus(listener: (next: UpdateState) => void) {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
				async check() {
					return current
				},
				async apply() {},
				async quitAndInstall() {},
			},
			async pickLibraryFolder() {
				return undefined
			},
			async relaunch() {},
			async openLogsFolder() {
				return true
			},
			async getConfig() {
				return {
					libraryPath: "",
					sharedFolderRoot: "",
					sharedFolderEnabled: false,
					port: 3000,
					lanEnabled: false,
					autoStart: false,
					startInTray: false,
					closeAction: "tray",
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async setConfig() {},
			async setCloseAction() {},
			async closeWithAction() {},
			setLanguage() {},
			async getLanguage() {
				return "en"
			},
			openExternal() {},
			registerAppRoutes() {},
			async getShellCacheSize() {
				return 0
			},
			async clearShellCache() {
				return 0
			},
			async completeWizard() {},
			async getWizardDefaults() {
				return { libraryPath: "" }
			},
		}
	}, initialState)
}

const updateDot = `[role="img"][aria-label="Update available"]`

test.describe("desktop update banner & badge (real browser)", () => {
	test.setTimeout(180_000)

	test("available shows the About dot and no banner at desktop width", async ({
		page,
	}) => {
		await installDesktopBridge(page, { status: "available", version: "9.9.9" })
		await login(page)

		const about = page.locator('a[href="/settings/about"]')
		await expect(about.locator(updateDot)).toBeVisible()
		await expect(page.getByTestId("desktop-update-banner")).toHaveCount(0)
		// The caption hamburger is absent at desktop width (no menu-button dot).
		await expect(page.getByTestId("app-sidebar-open")).toHaveCount(0)
	})

	test("ready resources shows the banner above Settings with Apply", async ({
		page,
	}) => {
		await installDesktopBridge(page, {
			status: "ready",
			channel: "resources",
			version: "9.9.9",
		})
		await login(page)

		const sidebar = page.getByTestId("app-sidebar")
		const banner = page.getByTestId("desktop-update-banner")
		await expect(banner).toBeVisible()
		await expect(sidebar.locator(banner)).toHaveCount(1)
		await expect(page.getByTestId("desktop-update-restart")).toHaveText("Apply")
	})

	test("ready full shows Reopen the app", async ({ page }) => {
		await installDesktopBridge(page, {
			status: "ready",
			channel: "full",
			version: "9.9.9",
		})
		await login(page)

		await expect(page.getByTestId("desktop-update-banner")).toBeVisible()
		await expect(page.getByTestId("desktop-update-restart")).toHaveText(
			"Reopen the app",
		)
		await expect(
			page.locator('a[href="/settings/about"]').locator(updateDot),
		).toBeVisible()
	})

	test("moves the update dot onto the menu button below the sidebar breakpoint", async ({
		page,
	}) => {
		await installDesktopBridge(page, { status: "available", version: "9.9.9" })
		await login(page)

		// 1150px is the sidebar breakpoint; drop below it to hide the sidebar.
		await page.setViewportSize({ width: 1100, height: 720 })
		const toggle = page.getByTestId("app-sidebar-open")
		await expect(toggle).toBeVisible()
		await expect(toggle.locator(updateDot)).toBeVisible()
	})

	test("shows and clears the applying overlay", async ({ page }) => {
		await installDesktopBridge(page, { status: "idle" })
		await login(page)

		await page.evaluate(() => {
			;(
				window as unknown as { __setUpdateState: (s: unknown) => void }
			).__setUpdateState({
				status: "applying",
				channel: "resources",
				phase: "stopping",
			})
		})
		await expect(page.getByTestId("desktop-update-applying")).toBeVisible()
		await expect(
			page.getByTestId("desktop-update-applying-phase"),
		).toContainText("Stopping")

		await page.evaluate(() => {
			;(
				window as unknown as { __setUpdateState: (s: unknown) => void }
			).__setUpdateState({ status: "latest" })
		})
		await expect(page.getByTestId("desktop-update-applying")).toHaveCount(0)
	})
})
