import { expect, type Page, test } from "@playwright/test"
import { strToU8, zipSync } from "fflate"
import { login } from "./helpers"
import {
	apiLogin,
	createResource,
	TINY_PNG,
	trpcPost,
	uploadOrderedFile,
} from "./serverApi"

/**
 * Upload-update reload regression (the same-mtime fingerprint bug).
 *
 * Archive entry timestamps are preserved by extraction (7-Zip restores
 * them), so the client fingerprint must be content-based: an update whose
 * index.html carries the SAME mtime as the previous release (repack
 * without a rebuild, normalized build timestamps) must still re-navigate
 * the preview iframe to a new `?v=` URL. The pre-fix mtime fingerprint
 * stayed put, so the UI claimed the new version while the iframe kept
 * running the old bundle.
 *
 * Navigation after the first install is SPA-only (route links, never
 * `page.goto`): the iframe pool must stay alive across the upload so the
 * fingerprint-driven reload — not a fresh page load — surfaces the new
 * bundle. A full page load would mask the regression even pre-fix.
 */
const FIX_ID = "44444444-4444-4444-8444-444444444444"
const SAME_MTIME = new Date("2024-01-01T00:00:00Z")

function fixtureZip(
	version: string,
	marker: string,
	bundleName: string,
): Buffer {
	return Buffer.from(
		zipSync({
			"manifest.json": [
				strToU8(
					JSON.stringify({
						id: FIX_ID,
						name: "E2E fingerprint fixture",
						description: "e2e upload-update reload fixture",
						version,
						permissions: {
							sourceMeta: false,
							searchMeta: false,
							danmaku: false,
							message: false,
							imageHashes: false,
							container: false,
							download: false,
						},
					}),
				),
				{ mtime: SAME_MTIME },
			],
			"main.js": [
				strToU8("export default { detect: () => ({ ok: true }) }\n"),
				{ mtime: SAME_MTIME },
			],
			"index.html": [
				strToU8(
					`<script type="module" src="./assets/${bundleName}"></script><div id="root"></div>`,
				),
				{ mtime: SAME_MTIME },
			],
			[`assets/${bundleName}`]: [
				strToU8(
					`window.top.postMessage({ type: "e2e-marker", marker: ${JSON.stringify(marker)} }, "*");`,
				),
				{ mtime: SAME_MTIME },
			],
		}),
	)
}

/** Drive the real zip-upload UI on the already-open settings/plugins page. */
async function installUi(page: Page, zip: Buffer) {
	await page.getByTestId("plugin-upload-input").setInputFiles({
		name: "fixture-plugin.zip",
		mimeType: "application/zip",
		buffer: zip,
	})
	const confirm = page.getByTestId("plugin-install-confirm")
	await expect(confirm).toBeVisible()
	// The consent dialog over the confirm dialog can swallow hit-tested
	// clicks (same DOM-click workaround as plugin-install-consent.spec).
	await confirm.evaluate((el) => (el as HTMLButtonElement).click())
	await expect(confirm).toBeHidden({ timeout: 30_000 })
}

/** Collect the plugin bundles the iframe actually executed. */
async function installMarkerListener(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as { __e2eMarkers?: string[] }
		w.__e2eMarkers = []
		window.addEventListener("message", (e) => {
			const m = e.data as { type?: unknown; marker?: unknown } | null
			if (m !== null && typeof m === "object" && m.type === "e2e-marker") {
				w.__e2eMarkers?.push(String(m.marker))
			}
		})
	})
}

async function markersOf(page: Page): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __e2eMarkers?: string[] }).__e2eMarkers ?? [],
	)
}

/** SPA navigation via the primary nav, then the card open button. */
async function openViaGrid(page: Page, resId: string) {
	await page.getByRole("link", { name: "Resources" }).first().click()
	await page.waitForURL(/\/resources$/)
	await page
		.locator(`[data-resource-card-id="${resId}"]`)
		.waitFor({ timeout: 60_000 })
	await page.locator(`[data-testid="resource-open-${resId}"]`).click()
	await page.waitForURL(new RegExp(`/resources/${resId}`))
}

/** SPA navigation to settings → plugins (route links, no full load). */
async function gotoPluginSettingsSpa(page: Page) {
	await page.getByRole("link", { name: "Settings" }).first().click()
	await page.waitForURL(/\/settings$/)
	await page.getByRole("link", { name: "Plugins" }).first().click()
	await page.waitForURL(/\/settings\/plugins$/)
}

test("upload update reloads the preview at a new fingerprint when zip mtimes match", async ({
	page,
	request,
}) => {
	test.setTimeout(180_000)
	await login(page)
	// The app shell's marketplace dot queries the snapshot on every page;
	// in the offline e2e stack that fetch stalls the initial route load.
	// Disable the marketplace for this spec (its own catalog is not under
	// test here).
	const cookie = await apiLogin(request)
	await trpcPost(request, cookie, "systemPreference.set", {
		key: "marketplace.registryRepo",
		value: "",
	})
	// v1 install, then a bound resource (full page loads are fine up to here).
	await page.goto("/settings/plugins")
	await installUi(page, fixtureZip("1.0.0", "V1-FP", "index-AAAA.js"))
	const fileId = await uploadOrderedFile(
		request,
		cookie,
		TINY_PNG,
		"pixel.png",
		"image/png",
	)
	const resId = await createResource(request, cookie, {
		name: "fingerprint-reload-res",
		contentPluginId: FIX_ID,
		files: [fileId],
		names: ["pixel.png"],
	})
	await page.goto("/resources")
	await page
		.locator(`[data-resource-card-id="${resId}"]`)
		.waitFor({ timeout: 60_000 })

	// From here on: SPA only — the pool must survive the update.
	await installMarkerListener(page)
	await page.locator(`[data-testid="resource-open-${resId}"]`).click()
	await page.waitForURL(new RegExp(`/resources/${resId}`))
	const preview = page.locator('iframe[title^="plugin:"]').first()
	await expect(preview).toHaveAttribute(
		"src",
		/\/api\/plugins\/44444444-4444-4444-8444-444444444444\/index\.html\?v=/,
		{ timeout: 30_000 },
	)
	const fp1 = await preview.getAttribute("src")
	await expect
		.poll(async () => markersOf(page), { timeout: 30_000 })
		.toContain("V1-FP")

	// Update in the same document: settings → plugins (SPA) → upload v2.
	await gotoPluginSettingsSpa(page)
	await installUi(page, fixtureZip("2.0.0", "V2-FP", "index-BBBB.js"))
	await expect(page.getByText("v2.0.0").first()).toBeVisible()

	// Reopen the resource (SPA) and expect the new bundle + new fingerprint.
	await openViaGrid(page, resId)
	await expect
		.poll(async () => preview.getAttribute("src"), {
			timeout: 30_000,
		})
		.not.toBe(fp1)
	await expect
		.poll(async () => markersOf(page), { timeout: 30_000 })
		.toContain("V2-FP")
})
