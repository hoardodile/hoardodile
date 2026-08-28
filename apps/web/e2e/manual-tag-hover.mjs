/**
 * Manual (screenshot-driven) verification of the tag link + art + hover
 * preview card, run against a manually booted dev stack (see the
 * instructions in the file header of `playwright.config.ts` for the env).
 *
 * Not part of the automated suite — captures evidence into
 * `.playwright/manual-screenshots/tag-hover-*.png` for visual review.
 *
 * Usage:
 *   node e2e/manual-tag-hover.mjs
 * (servers must already be running on 127.0.0.1:3000 / 127.0.0.1:5173)
 */
import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS = resolve(__dirname, ".playwright", "manual-screenshots")
const API = "http://127.0.0.1:3000"
const WEB = "http://127.0.0.1:5173"
const PASSWORD = "correct horse battery staple"

const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
)

function shot(name) {
	return resolve(SHOTS, name)
}

async function trpcPost(cookie, proc, data) {
	const res = await fetch(`${API}/trpc/${proc}`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify(data),
	})
	const body = await res.json()
	if (!res.ok || body?.error) {
		throw new Error(`${proc} failed: ${res.status} ${JSON.stringify(body)}`)
	}
	return body
}

function idFromTrpcJson(body) {
	const data = body?.result?.data
	const payload =
		data !== null && typeof data === "object" && "json" in data
			? data.json
			: data
	return payload?.id
}

async function apiLogin() {
	const res = await fetch(`${API}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password: PASSWORD }),
	})
	const setCookie = res.headers.get("set-cookie")
	if (setCookie === null) throw new Error("login: no cookie")
	return setCookie.split(";")[0]
}

async function putTagImage(cookie, tagId) {
	const res = await fetch(`${API}/api/tags/${tagId}/images/image`, {
		method: "PUT",
		headers: {
			cookie,
			"content-type": "application/octet-stream",
			"x-filename": "art.png",
		},
		body: TINY_PNG,
	})
	if (!res.ok) throw new Error(`tag image upload failed: ${res.status}`)
}

async function deleteTagImage(cookie, tagId) {
	const res = await fetch(`${API}/api/tags/${tagId}/images/image`, {
		method: "DELETE",
		headers: { cookie },
	})
	if (!res.ok) throw new Error(`tag image delete failed: ${res.status}`)
}

mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

async function waitLogin() {
	await page.goto(WEB, { timeout: 60_000 })
	await page.waitForURL(/\/login$/, { timeout: 30_000 })
	const setup = page.getByTestId("setup-submit")
	if ((await setup.count()) > 0) {
		await page.locator('input[type="password"]').nth(0).fill(PASSWORD)
		await page.locator('input[type="password"]').nth(1).fill(PASSWORD)
		await setup.click()
	} else {
		await page.locator('input[type="password"]').first().fill(PASSWORD)
		await page.getByTestId("login-submit").click()
	}
	await page.getByRole("navigation", { name: /primary/i }).waitFor()
}

await waitLogin()
const cookie = await apiLogin()

const catId = idFromTrpcJson(
	await trpcPost(cookie, "category.create", {
		name: "Manual Hover",
		kind: "common",
	}),
)
const tagId = idFromTrpcJson(
	await trpcPost(cookie, "tag.create", {
		name: "ManualTag",
		intro:
			"A tag with art, a link and an intro — the hover preview shows all three.",
		catId,
		link: "www.example.com/manual",
	}),
)
const charId = idFromTrpcJson(
	await trpcPost(cookie, "character.create", { name: "ManualChar" }),
)
await trpcPost(cookie, "tag.attachToCharacter", { entityId: charId, tagId })
await putTagImage(cookie, tagId)

// ── 1. Tags management: the edit dialog with the link field + image row ────
// The entity rows carry `aria-disabled="true"` while drag is off (dnd-kit
// sortable semantics), so Playwright's enabled-check needs `force`.
await page.goto(`${WEB}/settings/custom`)
await page.getByTestId(`tag-chip-${tagId}`).click({ force: true })
await page.getByTestId(`tag-open-edit-${tagId}`).click()
await page.getByTestId(`tag-edit-${tagId}`).waitFor()
await page.screenshot({ path: shot("01-tag-edit-link.png"), fullPage: false })
await page.keyboard.press("Escape")

// ── 2. Character detail: hover the chip → full card ────────────────────────
await page.goto(`${WEB}/characters/${charId}`)
const chip = page.getByRole("link", { name: "ManualTag" })
await chip.waitFor({ timeout: 15_000 })
await chip.hover()
await page.getByTestId(`tag-hover-name-${tagId}`).waitFor({ timeout: 5_000 })
await page.screenshot({ path: shot("02-hover-card-with-art.png") })
await page.mouse.move(10, 10)
await page.getByTestId(`tag-hover-name-${tagId}`).waitFor({ state: "hidden" })

// ── 3. Same card after the art is removed (text-only) ──────────────────────
await deleteTagImage(cookie, tagId)
await page.reload()
await chip.waitFor()
await chip.hover()
await page.getByTestId(`tag-hover-name-${tagId}`).waitFor({ timeout: 5_000 })
await page.screenshot({ path: shot("03-hover-text-only.png") })
await page.mouse.move(10, 10)

// ── 4. Dark theme + art restored ───────────────────────────────────────────
await putTagImage(cookie, tagId)
await page.reload()
await page.evaluate(() => {
	document.documentElement.classList.add("dark")
})
await chip.waitFor()
await chip.hover()
await page.getByTestId(`tag-hover-name-${tagId}`).waitFor({ timeout: 5_000 })
await page.screenshot({ path: shot("04-hover-dark.png") })

await browser.close()
console.log("manual screenshots written to", SHOTS, "— existence check:")
for (const name of [
	"01-tag-edit-link.png",
	"02-hover-card-with-art.png",
	"03-hover-text-only.png",
	"04-hover-dark.png",
]) {
	console.log(" ", name, existsSync(shot(name)) ? "OK" : "MISSING")
}
