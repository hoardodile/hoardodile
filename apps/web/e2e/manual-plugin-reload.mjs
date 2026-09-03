/**
 * Manual (one-command) verification of the plugin-replace reload fix with a
 * real browser + real seed artifacts:
 *
 *   After a plugin's client assets are rebuilt in place (its content
 *   fingerprint — the `assetVersion` hash — moves), opening a resource that
 *   owns it must load the NEW build WITHOUT the "content plugin -> file and
 *   back" toggle. This script proves the two halves of the fix end to end:
 *
 *   1. SERVER HALF: a dev plugin rebuilt in place reports a NEW assetVersion
 *      from `plugin.listAll` with NO rescan/server restart.
 *   2. CLIENT HALF: reopening (SPA, no full page reload) a gallery resource
 *      re-navigates the preview iframe to the new `?v=` fingerprint and still
 *      renders — no content-plugin switch.
 *
 * It boots a temporary server+SPA stack and points `DEV_PLUGIN_PATHS` at a
 * THROWAWAY COPY of the in-repo gallery dist, so the repo checkout is never
 * mutated. The reused-bundle correction (v1 -> v2 on a cold bootstrap) is
 * covered deterministically by the jsdom unit suite (use-iframe-slot.test);
 * this is the real-browser + seed-data smoke.
 *
 * Not part of the automated suite — captures evidence into
 * `.playwright/manual-screenshots/plugin-reload-*.png` and prints a timeline.
 *
 * Usage (from apps/web, after `pnpm build:pkgs`):
 *   node e2e/manual-plugin-reload.mjs
 *
 * Env: MANUAL_SERVER_PORT 3000, MANUAL_WEB_PORT 5173.
 */
import { spawn } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateSync } from "node:zlib"
import { chromium } from "@playwright/test"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(__dirname, "..")
const REPO_ROOT = resolve(WEB_DIR, "..", "..")
const SERVER_PORT = Number(process.env.MANUAL_SERVER_PORT ?? 3000)
const WEB_PORT = Number(process.env.MANUAL_WEB_PORT ?? 5173)
const PASSWORD = "correct horse battery staple"

const STATE = resolve(WEB_DIR, ".playwright")
const STORAGE_ROOT = join(STATE, "manual-reload-storage")
const DB_PATH = join(STATE, "manual-reload.sqlite3")
const SHOTS = join(STATE, "manual-screenshots")
// A throwaway copy of the gallery dist so the rebuild never touches the repo.
const PLUGIN_COPY = join(STATE, "manual-reload-plugin")

const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"
const SRC_DIST = resolve(REPO_ROOT, "plugins", "gallery", "dist")

mkdirSync(SHOTS, { recursive: true })
rmSync(STORAGE_ROOT, { recursive: true, force: true })
rmSync(`${DB_PATH}-wal`, { force: true })
rmSync(`${DB_PATH}-shm`, { force: true })
rmSync(DB_PATH, { force: true })
rmSync(PLUGIN_COPY, { recursive: true, force: true })

if (!existsSync(join(SRC_DIST, "index.html"))) {
	throw new Error(
		`gallery dist missing: ${SRC_DIST} — run pnpm build:pkgs first`,
	)
}
// Copy the built dist (assets/, index.html, main.js, manifest.json) into the
// throwaway dir the server's DEV_PLUGIN_PATHS points at.
cpSync(SRC_DIST, PLUGIN_COPY, { recursive: true })

// ── Boot the temporary stack ────────────────────────────────────────────────

const children = []
function log(msg) {
	console.log(`[manual] ${msg}`)
}
function spawnChild(name, cmd, args, env) {
	const child = spawn(cmd, args, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		stdio: ["ignore", "ignore", "ignore"],
		windowsHide: true,
		shell: cmd === "pnpm", // corepack shims on Windows are a .cmd
	})
	child.on("error", (err) => log(`${name} spawn error: ${String(err)}`))
	child.on("exit", (code) => log(`${name} exited (${code})`))
	children.push(child)
	return child
}
function killTree(pid) {
	const cmd = process.platform === "win32" ? "taskkill" : "kill"
	const args =
		process.platform === "win32"
			? ["/PID", String(pid), "/T", "/F"]
			: ["-INT", String(pid)]
	spawn(cmd, args, { stdio: "ignore", windowsHide: true })
}

async function waitFor(label, url, timeoutMs = 60_000) {
	const t0 = Date.now()
	for (;;) {
		try {
			const res = await fetch(url)
			if (res.ok) return Date.now() - t0
		} catch {
			// not up yet
		}
		if (Date.now() - t0 > timeoutMs)
			throw new Error(`${label} did not come up: ${url}`)
		await new Promise((r) => setTimeout(r, 500))
	}
}

spawnChild(
	"app-server",
	"pnpm",
	["-F", "@hoardodile/server", "exec", "vite-node", "src/main.ts"],
	{
		NODE_ENV: "development",
		HOST: "127.0.0.1",
		PORT: String(SERVER_PORT),
		LOG_LEVEL: "warn",
		DATABASE_URL: DB_PATH,
		SESSION_COOKIE_NAME: "app_session_manual_reload",
		SESSION_SECURE_COOKIE: "false",
		STORAGE_ROOT,
		RESTART_ON_RESTORE: "false",
		DEV_PLUGIN_PATHS: PLUGIN_COPY,
	},
)
spawnChild(
	"web",
	"pnpm",
	[
		"-F",
		"@hoardodile/web",
		"exec",
		"vite",
		"--host",
		"127.0.0.1",
		"--port",
		String(WEB_PORT),
		"--strictPort",
	],
	{ VITE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}` },
)

function shutdown() {
	for (const child of children) killTree(child.pid)
}

// ── Tiny HTTP + PNG helpers ─────────────────────────────────────────────────

function solidPng(width, height, [r, g, b]) {
	const raw = Buffer.alloc((width * 3 + 1) * height)
	for (let y = 0; y < height; y++) {
		const row = y * (width * 3 + 1)
		raw[row] = 0
		for (let x = 0; x < width; x++) {
			const i = row + 1 + x * 3
			raw[i] = r
			raw[i + 1] = g
			raw[i + 2] = b
		}
	}
	function chunk(type, data) {
		const len = Buffer.alloc(4)
		len.writeUInt32BE(data.length)
		const body = Buffer.concat([Buffer.from(type, "ascii"), data])
		const crc = Buffer.alloc(4)
		crc.writeUInt32BE(crc32(body) >>> 0)
		return Buffer.concat([len, body, crc])
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = 2
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	])
}

async function apiLogin() {
	const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password: PASSWORD }),
	})
	const setCookie = res.headers.get("set-cookie")
	if (setCookie === null) throw new Error("login: no cookie")
	return setCookie.split(";")[0]
}
async function trpcPost(cookie, proc, data) {
	const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/trpc/${proc}`, {
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
// plugin.listAll is a QUERY → GET with the input serialized into the URL.
async function trpcGet(cookie, proc) {
	const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/trpc/${proc}`, {
		headers: { cookie },
	})
	if (!res.ok) throw new Error(`${proc} GET failed: ${res.status}`)
	return res.json()
}
function idFromTrpcJson(body) {
	const data = body?.result?.data
	const payload =
		data !== null && typeof data === "object" && "json" in data
			? data.json
			: data
	return payload?.id
}
function unwrapTrpc(body) {
	const data = body?.result?.data
	const payload =
		data !== null && typeof data === "object" && "json" in data
			? data.json
			: data
	return payload
}

async function createGalleryResource(cookie, name) {
	const res = await fetch(
		`http://127.0.0.1:${SERVER_PORT}/api/uploads/ordered`,
		{
			method: "POST",
			headers: { cookie },
			body: (() => {
				const form = new FormData()
				form.append(
					"file",
					new File([solidPng(4, 4, [30, 30, 220])], "pixel.png", {
						type: "image/png",
					}),
				)
				return form
			})(),
		},
	)
	if (!res.ok)
		throw new Error(`ordered upload failed: ${res.status} ${await res.text()}`)
	const fileId = (await res.json()).fileId
	return idFromTrpcJson(
		await trpcPost(cookie, "resource.create", {
			name,
			contentPluginId: GALLERY_PLUGIN_ID,
			files: [fileId],
			names: ["pixel.png"],
		}),
	)
}

/** assetVersion of the gallery plugin from the live registry (no rescan). */
async function galleryAssetVersion(cookie) {
	const list = unwrapTrpc(await trpcGet(cookie, "plugin.listAll"))
	if (!Array.isArray(list)) {
		throw new Error(
			`plugin.listAll returned a non-list: ${JSON.stringify(list)}`,
		)
	}
	return list.find((p) => p.id === GALLERY_PLUGIN_ID)?.assetVersion
}

// ── UI flow ─────────────────────────────────────────────────────────────────

const timeline = []
function step(name, ms) {
	timeline.push(`${name}: ${Math.round(ms)} ms`)
	log(`${name}: ${Math.round(ms)} ms`)
}

async function waitLogin(page) {
	await page.goto(`http://127.0.0.1:${WEB_PORT}`, { timeout: 60_000 })
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

/** Open a resource detail page via a real router click (SPA), not a reload. */
async function openViaGrid(page, resId) {
	const card = page.locator(`[data-resource-card-id="${resId}"]`)
	await card.waitFor({ timeout: 30_000 })
	await card.locator(`[data-testid="resource-open-${resId}"]`).click()
	await page.waitForURL(new RegExp(`/resources/${resId}`), { timeout: 30_000 })
	const iframe = page
		.locator(`[data-testid="resource-detail-preview"] iframe[title^="plugin:"]`)
		.first()
	await iframe.waitFor({ timeout: 60_000 })
	// Let the plugin accept its context and paint a frame before reading.
	await page.waitForFunction(
		(el) => el.style.opacity === "1",
		await iframe.elementHandle(),
		{ timeout: 30_000 },
	)
	return iframe
}

/** Return to the resources grid via the primary nav (SPA, no reload). */
async function backToGrid(page) {
	await page.getByRole("link", { name: "Resources" }).first().click()
	await page.waitForURL(/\/resources$/, { timeout: 30_000 })
}

async function main() {
	await waitFor("app server", `http://127.0.0.1:${SERVER_PORT}/health`)
	await waitFor("spa", `http://127.0.0.1:${WEB_PORT}`)

	const browser = await chromium.launch()
	const page = await browser.newPage({
		viewport: { width: 1600, height: 1000 },
	})
	await waitLogin(page)
	log("server claimed + signed in")
	const cookie = await apiLogin()

	// Seed two gallery resources (A is previewed before the rebuild, B after —
	// a cold previewInitContext so the corrected fingerprint reaches the client
	// deterministically).
	const resA = await createGalleryResource(cookie, "manual-reload-a")
	const resB = await createGalleryResource(cookie, "manual-reload-b")
	log(`seeded resources: A=${resA} B=${resB}`)

	// Baseline fingerprint pre-rebuild from the live registry.
	const v1 = await galleryAssetVersion(cookie)
	if (v1 === undefined)
		throw new Error("gallery plugin reports no assetVersion")
	log(`baseline assetVersion: ${v1}`)

	// 1) Open A (via the grid + router click — SPA). The preview iframe must be
	//    built at the baseline fingerprint.
	//    Landing on the grid is the one full load; every later nav is router.
	await page.goto(`http://127.0.0.1:${WEB_PORT}/resources`)
	await page.locator(`[data-resource-card-id="${resA}"]`).waitFor({
		timeout: 30_000,
	})
	let t0 = Date.now()
	const iframeA = await openViaGrid(page, resA)
	const srcA = await iframeA.getAttribute("src")
	step("open A (preview built)", Date.now() - t0)
	log(`A iframe src: ${srcA}`)
	const fpA = new URL(`http://x${srcA}`).searchParams.get("v")
	if (fpA !== v1) {
		throw new Error(`A iframe fingerprint ${fpA} !== baseline ${v1}`)
	}
	await page.screenshot({ path: join(SHOTS, "plugin-reload-01-before.png") })

	// 2) SERVER HALF: "rebuild" the plugin in place (rewrite index.html so
	//    the content fingerprint moves) with no rescan/restart. The dev-plugin
	//    re-hash must report a NEW assetVersion from plugin.listAll.
	t0 = Date.now()
	const indexHtml = join(PLUGIN_COPY, "index.html")
	writeFileSync(
		indexHtml,
		`${readFileSync(indexHtml, "utf8")}\n<!-- manual rebuild ${Date.now()} -->`,
	)
	const v2 = await galleryAssetVersion(cookie)
	step("rebuild → listAll reports new fingerprint", Date.now() - t0)
	log(`assetVersion after rebuild: ${v2} (was ${v1})`)
	if (v2 === undefined || v2 === v1) {
		throw new Error(
			`dev-plugin fingerprint did not move after an in-place rebuild (${v1} -> ${v2}) — the server half of the fix is not active`,
		)
	}

	// 3) CLIENT HALF: back to the grid (router) then open B — NO "content
	//    plugin -> file and back" toggle, no full reload. The preview iframe
	//    must re-claim/re-navigate at the NEW fingerprint and still render.
	await backToGrid(page)
	t0 = Date.now()
	const iframeB = await openViaGrid(page, resB)
	const srcB = await iframeB.getAttribute("src")
	step("open B (preview after rebuild, no toggle)", Date.now() - t0)
	log(`B iframe src: ${srcB}`)
	const fpB = new URL(`http://x${srcB}`).searchParams.get("v")
	if (fpB !== v2) {
		throw new Error(
			`B iframe fingerprint ${fpB} !== rebuilt fingerprint ${v2} — the new build was not picked up without the toggle`,
		)
	}
	await page.screenshot({ path: join(SHOTS, "plugin-reload-02-after.png") })

	console.log("\n=== timeline ===")
	for (const line of timeline) console.log(line)
	console.log("\nscreenshots:", SHOTS)
	await browser.close()
}

try {
	await main()
} finally {
	shutdown()
}
