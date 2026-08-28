import { existsSync, readdirSync, readFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { strToU8, zipSync } from "fflate"
import { login } from "./helpers"

/**
 * The plugin-install consent flow: a fixture plugin (zero-import
 * `main.js`, so no SDK build step) declares `onInstall` and downloads one
 * pinned runtime file from the loopback fixture server
 * (`e2e/runtime-server.mjs`, started by playwright.config.ts). The spec
 * drives the real zip-upload UI and asserts the shared consent dialog:
 *
 * - install → consent appears (regression guard: delivery used to lag
 *   30–60 s behind a flaky SSE stream) → Allow lands the vault file;
 * - deny → nothing lands → re-install asks again → Allow lands it.
 *
 * The update-over-existing-vault path (second install of the same zip) is
 * NOT driven here: on Windows the vault-aside rename in the plugin commit
 * fails with a persistent EPERM right after a fresh vault write (repro,
 * see the `moveDir` retry in `apps/server/src/domain/plugin/upload.ts`);
 * cached-hit-silence is covered by the asset-service unit tests.
 *
 * Skipped in external-server mode: the fixture runtime lives on the host
 * loopback, which the external (container) downloader cannot reach.
 */
const externalBaseUrl = process.env.E2E_EXTERNAL_BASE_URL
test.skip(
	externalBaseUrl !== undefined,
	"plugin-install consent e2e requires the local webServer (loopback runtime fixture)",
)

const ALLOW_ID = "00000000-0000-4000-8000-000000000001"
const DENY_ID = "00000000-0000-4000-8000-000000000002"

const storageRoot = resolve(import.meta.dirname, "..", ".playwright", "storage")
const fixtureMainJs = resolve(
	import.meta.dirname,
	"fixtures",
	"plugin-runtime-consent",
	"main.js",
)

/** Build the fixture plugin zip in memory (fflate; manifest + main.js). */
function fixtureZip(opts: {
	readonly id: string
	readonly name: string
	readonly url: string
	readonly dest: string
}): Buffer {
	const mainJs = readFileSync(fixtureMainJs, "utf8")
		.replaceAll("__E2E_RUNTIME_URL__", opts.url)
		.replaceAll("__E2E_DEST__", opts.dest)
	const manifest = JSON.stringify({
		id: opts.id,
		name: opts.name,
		description: "e2e consent fixture plugin",
		version: "0.0.0",
		permissions: {
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
			container: false,
			download: true,
		},
	})
	return Buffer.from(
		zipSync({
			"manifest.json": strToU8(manifest),
			"main.js": strToU8(mainJs),
		}),
	)
}

/** Absolute vault path for a plugin file, or undefined when absent. */
function vaultFile(pluginId: string, rel: string): string | undefined {
	try {
		const suffix = ["plugins", pluginId, "vault", ...rel.split("/")].join(sep)
		for (const entry of readdirSync(storageRoot, {
			recursive: true,
			encoding: "utf8",
		})) {
			const candidate = resolve(storageRoot, entry)
			if (candidate.endsWith(suffix) && existsSync(candidate)) {
				return candidate
			}
		}
	} catch {
		// storage missing — the file cannot exist yet.
	}
	return undefined
}

async function expectVaultFile(pluginId: string, rel: string): Promise<void> {
	await expect
		.poll(() => vaultFile(pluginId, rel), { timeout: 30_000 })
		.toBeTruthy()
}

/** Drive the zip-upload UI: pick the file, confirm the install dialog. */
async function installUi(page: Page, zip: Buffer) {
	await page.goto("/settings/plugins")
	await page.getByTestId("plugin-upload-input").setInputFiles({
		name: "fixture-plugin.zip",
		mimeType: "application/zip",
		buffer: zip,
	})
	const confirm = page.getByTestId("plugin-install-confirm")
	await expect(confirm).toBeVisible()
	// The install-time consent dialog can pop over the confirm dialog the
	// moment the upload completes (z-70 over z-50) and its scrim would
	// swallow a hit-tested click — dispatch the DOM click directly.
	await confirm.evaluate((el) => (el as HTMLButtonElement).click())
	// Confirm closes only on success — a failed upload keeps the dialog
	// open with an error toast.
	await expect(confirm).toBeHidden({ timeout: 30_000 })
}

test("installing a plugin with onInstall asks consent once and Allow lands the vault file", async ({
	page,
}) => {
	const zip = fixtureZip({
		id: ALLOW_ID,
		name: "E2E Runtime Fixture",
		url: process.env.E2E_RUNTIME_URL ?? "",
		dest: "runtime/fixture.js",
	})
	await login(page)
	// The install-time consent dialog is delivered over the SSE stream —
	// the tab must be connected (leader) before the ticket can appear.
	await expect
		.poll(() =>
			page.evaluate(() => document.documentElement.dataset.sseConnected ?? ""),
		)
		.toBe("1")

	const t0 = Date.now()
	await installUi(page, zip)
	const dialog = page.getByTestId("plugin-download-consent")
	await expect(dialog).toBeVisible({ timeout: 20_000 })
	console.log(`install → consent dialog: ${Date.now() - t0} ms`)

	await page.getByTestId("plugin-download-allow").click()
	await expectVaultFile(ALLOW_ID, "runtime/fixture.js")
	await expect(dialog).toHaveCount(0)
})

test("denying leaves the vault empty and the next install asks again", async ({
	page,
}) => {
	const zip = fixtureZip({
		id: DENY_ID,
		name: "E2E Deny Fixture",
		url: process.env.E2E_RUNTIME_DENY_URL ?? "",
		dest: "runtime/deny.js",
	})
	await login(page)

	const dialog = page.getByTestId("plugin-download-consent")
	await installUi(page, zip)
	await expect(dialog).toBeVisible({ timeout: 20_000 })
	await page.getByTestId("plugin-download-deny").click()
	await expect(dialog).toHaveCount(0)
	expect(vaultFile(DENY_ID, "runtime/deny.js")).toBeUndefined()

	// Re-install: the runtime is still missing, so consent is asked again.
	await installUi(page, zip)
	await expect(dialog).toBeVisible({ timeout: 20_000 })
	await page.getByTestId("plugin-download-allow").click()
	await expectVaultFile(DENY_ID, "runtime/deny.js")
})
