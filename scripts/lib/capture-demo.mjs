/**
 * Playwright capture of the official demo library. Injects a noop
 * `window.hoardodileDesktop` before SPA boot so caption / desktop layout
 * match dest without launching Electron.
 */

import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { WORKSPACE_ROOT } from "./workspace.mjs"

const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"
const VIEWPORT = { width: 1600, height: 900 }
const FIRST_GOTO_MS = 180_000
const SETTLE_MS = 400

/**
 * Same shape as `installDesktopBridge` in AppShell.test.tsx. Runs in the
 * page before `main.tsx` reads `isHoardodileDesktop()`.
 */
function installDesktopBridge() {
	window.hoardodileDesktop = {
		isDesktop: true,
		platform: "desktop",
		minimize() {},
		toggleMaximize() {},
		close() {},
		async isMaximized() {
			return false
		},
		onMaximizedChange() {
			return () => undefined
		},
		updates: {
			portable: false,
			async status() {
				return { status: "idle" }
			},
			onStatus() {
				return () => undefined
			},
			async check() {},
			async quitAndInstall() {},
		},
		async pickLibraryFolder() {
			return undefined
		},
		async relaunch() {},
		async getConfig() {
			return {
				libraryPath: "",
				sharedFolderRoot: "",
				sharedFolderEnabled: false,
				autoStart: false,
				startInTray: false,
				autoUpdate: false,
				portable: false,
			}
		},
		async setConfig() {},
		async changeLibraryFolder() {},
		async setSharedFolderRoot() {},
		async setSharedFolderEnabled() {},
		async completeWizard() {},
		async getWizardDefaults() {
			return { libraryPath: "" }
		},
	}
}

async function loadChromium() {
	const require = createRequire(join(WORKSPACE_ROOT, "apps/web/package.json"))
	const fromTest = createRequire(require.resolve("@playwright/test"))
	const entry = join(
		dirname(fromTest.resolve("playwright/package.json")),
		"index.mjs",
	)
	const { chromium } = await import(pathToFileURL(entry).href)
	return chromium
}

function namedId(rows, name) {
	const row = rows.find((item) => item.name === name)
	if (row === undefined) {
		const known = rows.map((item) => item.name).join(", ")
		throw new Error(
			`demo-seed.json has no ${JSON.stringify(name)} (have: ${known})`,
		)
	}
	return row.id
}

function readManifest(storageRoot) {
	const path = join(storageRoot, "local", "demo-seed.json")
	const parsed = JSON.parse(readFileSync(path, "utf8"))
	if (parsed?.kind !== "hoardodile-demo-seed" || parsed.status !== "complete") {
		throw new Error(`demo seed is not complete: ${path}`)
	}
	return parsed
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForImages(page) {
	await page.evaluate(async () => {
		const pending = [...document.images].filter((img) => !img.complete)
		await Promise.all(
			pending.map(
				(img) =>
					new Promise((resolve) => {
						img.addEventListener("load", resolve, { once: true })
						img.addEventListener("error", resolve, { once: true })
					}),
			),
		)
	})
}

async function settle(page) {
	await page.getByTestId("desktop-caption-bar").waitFor({ timeout: 30_000 })
	await Promise.race([waitForImages(page), sleep(10_000)])
	await sleep(SETTLE_MS)
}

async function openPath(page, baseUrl, pathname) {
	await page.goto(new URL(pathname, baseUrl).href, {
		waitUntil: "load",
		timeout: FIRST_GOTO_MS,
	})
	await settle(page)
}

async function screenshot(page, outDir, filename) {
	await settle(page)
	const dest = join(outDir, filename)
	await page.screenshot({ path: dest })
	console.log(`[seed:screenshots] wrote ${filename}`)
}

async function signIn(page, baseUrl) {
	await openPath(page, baseUrl, "/login")
	await page.getByTestId("sign-in-heading").waitFor({ timeout: 30_000 })
	await page.waitForFunction(() => {
		const input = document.querySelector("form input")
		return input instanceof HTMLInputElement && input.value === "demo"
	})
}

async function pinOverviewFilter(page, title) {
	await page.getByTestId("resource-pin-overview-settings").click()
	const dialog = page.getByRole("dialog")
	await dialog.waitFor({ timeout: 10_000 })
	if ((await dialog.getByText(title, { exact: true }).count()) > 0) {
		await dialog.getByRole("button", { name: "Done" }).click()
		await dialog.waitFor({ state: "hidden" })
		return
	}
	await dialog.getByTestId("pinned-add-button").click()
	const titleInput = dialog.locator('input[id^="pinned-title-"]')
	await titleInput.waitFor({ timeout: 10_000 })
	await titleInput.fill(title)
	await dialog.getByRole("button", { name: "Done" }).click()
	await dialog.waitFor({ state: "hidden" })
}

/**
 * @param {{
 *   readonly baseUrl: string
 *   readonly outDir: string
 *   readonly storageRoot: string
 * }} opts
 */
export async function captureDemo(opts) {
	const { baseUrl, outDir, storageRoot } = opts
	mkdirSync(outDir, { recursive: true })
	const manifest = readManifest(storageRoot)
	const earthId = namedId(manifest.resources, "地球相册")
	const monaId = namedId(manifest.resources, "蒙娜丽莎")
	const graceId = namedId(manifest.resources, "地球重力场")
	const marieId = namedId(manifest.chars, "玛丽")
	const notesId = namedId(manifest.docs, "Field notes")

	const chromium = await loadChromium()
	const browser = await chromium.launch({ headless: true })
	const context = await browser.newContext({
		viewport: VIEWPORT,
		locale: "en-US",
		deviceScaleFactor: 1,
	})
	await context.addInitScript(installDesktopBridge)
	const page = await context.newPage()
	page.setDefaultTimeout(30_000)

	try {
		await signIn(page, baseUrl)
		await screenshot(page, outDir, "01-login.png")
		await page.getByTestId("login-submit").click()
		await page.getByTestId("app-sidebar").waitFor({ timeout: 30_000 })
		await settle(page)

		await openPath(page, baseUrl, "/resources")
		await page.getByTestId("resource-list").waitFor({ timeout: 30_000 })
		await pinOverviewFilter(page, "深空档案")
		await pinOverviewFilter(page, "画廊")

		await openPath(page, baseUrl, "/")
		await page.getByTestId("overview-library-stat-strip").waitFor({
			timeout: 30_000,
		})
		await page.getByTestId("overview-pinned-row").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "02-overview.png")

		const resourcesSearch = new URLSearchParams({
			view: "masonry",
			contentPluginId: GALLERY_PLUGIN_ID,
		})
		await openPath(page, baseUrl, `/resources?${resourcesSearch.toString()}`)
		await page.getByTestId("resource-list").waitFor({ timeout: 30_000 })
		const masonry = page.getByTestId("view-toggle-masonry")
		if ((await masonry.getAttribute("aria-pressed")) !== "true") {
			await masonry.click()
			await page.getByTestId("resource-list").waitFor({ timeout: 30_000 })
		}
		await screenshot(page, outDir, "03-resources.png")

		await openPath(page, baseUrl, `/resources/${earthId}`)
		await page.getByTestId("resource-detail-title").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "04-resource-earth.png")

		await openPath(page, baseUrl, `/resources/${monaId}`)
		await page.getByTestId("resource-detail-title").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "05-resource-mona.png")

		await openPath(page, baseUrl, `/resources/${graceId}`)
		await page.getByTestId("resource-detail-title").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "06-resource-grace.png")

		await openPath(page, baseUrl, "/characters")
		await page.getByTestId("character-list").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "07-characters.png")

		await openPath(page, baseUrl, `/characters/${marieId}`)
		await page.getByTestId("character-detail-name").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "08-character-marie.png")

		await openPath(page, baseUrl, `/documents/${notesId}`)
		await page.getByTestId("document-title").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "09-documents.png")

		await openPath(page, baseUrl, "/settings/custom")
		await page.getByTestId("me-tag-rules").waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "10-settings-custom.png")

		await openPath(page, baseUrl, "/settings/plugins")
		await page
			.getByTestId("plugins-installed-section")
			.waitFor({ timeout: 30_000 })
		await screenshot(page, outDir, "11-settings-plugins.png")

		await openPath(page, baseUrl, `/search?query=${encodeURIComponent("地球")}`)
		await page.getByText("地球相册", { exact: true }).waitFor({
			timeout: 30_000,
		})
		await screenshot(page, outDir, "12-search.png")
	} finally {
		await browser.close()
	}
}
