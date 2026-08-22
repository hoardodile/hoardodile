/**
 * Workbench smoke test: boots against a running workbench dev server,
 * loads the page, and waits for the plugin iframe to render the mounted
 * data directory through the offline mock host — proving the full
 * postMessage bridge, hook snapshot and file backend work in a real
 * browser with no hoardodile server.
 *
 * Start the workbench first, from the plugin directory:
 *   pnpm dev                                   # hoardodile plugin dev
 * or standalone:
 *   pnpm -F @hoardodile/workbench dev -- --plugin <dist> --data <dir>
 *
 * Then:
 *   node plugins/workbench/scripts/smoke.mjs [url] [--expect media|text]
 *
 * `media` (default) requires at least one <img>/<video>; `text` requires
 * the iframe to have painted a meaningful amount of text, which is what
 * a reader plugin produces.
 */
import { chromium } from "@playwright/test"

const args = process.argv.slice(2)
const baseUrl = args.find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:5199"
const expectIndex = args.indexOf("--expect")
const expect = expectIndex === -1 ? "media" : (args[expectIndex + 1] ?? "media")
if (expect !== "media" && expect !== "text") {
	throw new Error(`--expect must be "media" or "text", got "${expect}"`)
}

/** A reader has painted when it shows more than a loading placeholder. */
const MIN_TEXT_LENGTH = 200

const browser = await chromium.launch()
try {
	const page = await browser.newPage()
	const errors = []
	page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(`console: ${msg.text()}`)
	})

	await page.goto(baseUrl, { waitUntil: "networkidle" })
	console.log(`plugin label: ${await page.textContent("#plugin-name")}`)
	console.log(`hooks: ${await page.textContent("#hook-status")}`)

	// The plugin iframe must mount (context push → paint).
	const frame = await page.waitForSelector("iframe", { timeout: 10_000 })
	const frameHandle = await frame.contentFrame()
	if (frameHandle === null) throw new Error("iframe has no frame")
	if (expect === "media") {
		await frameHandle.waitForSelector("img, video", { timeout: 15_000 })
	} else {
		await frameHandle.waitForFunction(
			(min) => (document.body.innerText ?? "").trim().length >= min,
			MIN_TEXT_LENGTH,
			{ timeout: 15_000 },
		)
	}
	await page.waitForTimeout(2_000)

	if (expect === "media") {
		const media = await frameHandle.locator("img, video").count()
		console.log(`media elements rendered in plugin iframe: ${media}`)
		if (media === 0) {
			throw new Error("no media rendered — mock file backend failed")
		}
	} else {
		const text = (await frameHandle.locator("body").innerText()).trim()
		console.log(`text rendered in plugin iframe: ${text.length} chars`)
		if (text.length < MIN_TEXT_LENGTH) {
			throw new Error(
				`only ${text.length} chars rendered — expected at least ${MIN_TEXT_LENGTH}; the plugin likely never received its file content`,
			)
		}
	}

	if (errors.length > 0) {
		console.error("page errors:", errors)
		throw new Error("page errors detected")
	}
	console.log("SMOKE OK")
} finally {
	await browser.close()
}
