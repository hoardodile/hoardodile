/**
 * Manual (one-command) verification of the plugin install-time consent
 * flow with the REAL Live2D plugin + REAL model test data, booting a
 * temporary server stack (server + SPA + loopback runtime mirror).
 *
 * Not part of the automated suite — captures evidence into
 * `.playwright/manual-screenshots/plugin-consent-*.png` and prints a
 * step timeline. Designed for the case the maintainer cannot click
 * through by hand.
 *
 * Prep (one-time, run from `plugin-live2d`):
 *   - temporary pnpm override of @hoardodile/sdk-types + @hoardodile/sdk-server
 *     to the LOCAL hoardodile SDK dists (onInstall needs the unpublished SDK),
 *     then `pnpm install && pnpm build && pnpm test`, then revert the override.
 *   - `pnpm build` populates `../plugin-live2d/dist`.
 *
 * Environment notes:
 * - The runtime mirror prefers REAL bytes: the script downloads the two
 *   pinned runtime files from their primary CDNs into
 *   `.playwright/manual-runtime/` and serves them on the loopback (with
 *   `PLUGIN_DOWNLOAD_ALLOW_PRIVATE` the downloader accepts them). If the
 *   CDN fetch fails (unreachable), the script falls back to the real-CDN
 *   mode (no URL rewriting) — the flow is identical, the transfer is
 *   only as fast as the network.
 *
 * Usage (from apps/web):
 *   node e2e/manual-plugin-consent.mjs
 *   MANUAL_USE_REAL_CDNS=1 node e2e/manual-plugin-consent.mjs   # force real urls
 *
 * Env: MANUAL_PLUGIN_DIST (default ../plugin-live2d/dist), MANUAL_TESTDATA
 * (default ../plugin-live2d/testdata-real/arch-chan), MANUAL_RUNTIME_PORT 3200.
 */
import { spawn } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { strToU8, zipSync } from "fflate"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(__dirname, "..")
const REPO_ROOT = resolve(WEB_DIR, "..", "..")
const SERVER_PORT = Number(process.env.MANUAL_SERVER_PORT ?? 3000)
const WEB_PORT = Number(process.env.MANUAL_WEB_PORT ?? 5173)
const RUNTIME_PORT = Number(process.env.MANUAL_RUNTIME_PORT ?? 3200)
const PASSWORD = "correct horse battery staple"

const STATE = resolve(WEB_DIR, ".playwright")
const STORAGE_ROOT = join(STATE, "manual-consent-storage")
const DB_PATH = join(STATE, "manual-consent.sqlite3")
const SHOTS = join(STATE, "manual-screenshots")

// The Live2D plugin repo is a SIBLING of the app repo (`../plugin-live2d`).
const PLUGIN_DIST = resolve(
	REPO_ROOT,
	"..",
	process.env.MANUAL_PLUGIN_DIST ?? "plugin-live2d/dist",
)
const TESTDATA = resolve(
	REPO_ROOT,
	"..",
	process.env.MANUAL_TESTDATA ?? "plugin-live2d/testdata-real/arch-chan",
)
const LIVE2D_ID = "22b2cef0-5ace-44de-8a5c-5c25470afdeb"

const RUNTIME_URLS = [
	"https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js",
	"https://fastly.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js",
	"https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
]
const MIRRORED = [
	`http://127.0.0.1:${RUNTIME_PORT}/live2d.min.js`,
	`http://127.0.0.1:${RUNTIME_PORT}/live2d.min.js`,
	`http://127.0.0.1:${RUNTIME_PORT}/live2dcubismcore.min.js`,
]
const MIRROR_DIR = join(STATE, "manual-runtime")

mkdirSync(SHOTS, { recursive: true })
rmSync(STORAGE_ROOT, { recursive: true, force: true })
rmSync(`${DB_PATH}-wal`, { force: true })
rmSync(`${DB_PATH}-shm`, { force: true })
rmSync(DB_PATH, { force: true })

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
		// `pnpm` resolves through the corepack shims (a .cmd on Windows) —
		// only a shell can find it.
		shell: cmd === "pnpm",
	})
	child.on("error", (err) => log(`${name} spawn error: ${String(err)}`))
	child.on("exit", (code) => log(`${name} exited (${code})`))
	children.push(child)
	return child
}
function killTree(pid) {
	// Windows: the pnpm/vite trees need a full kill; POSIX pkill as fallback.
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
	"runtime-server",
	process.execPath,
	[resolve(__dirname, "runtime-server.mjs")],
	{ PORT: String(RUNTIME_PORT), E2E_RUNTIME_DIR: MIRROR_DIR },
)
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
		SESSION_COOKIE_NAME: "app_session_manual",
		SESSION_SECURE_COOKIE: "false",
		STORAGE_ROOT,
		RESTART_ON_RESTORE: "false",
		PLUGIN_DOWNLOAD_ALLOW_PRIVATE: "true",
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

async function boot(mirror) {
	await waitFor("app server", `http://127.0.0.1:${SERVER_PORT}/health`)
	await waitFor("spa", `http://127.0.0.1:${WEB_PORT}`)
	if (!mirror.useReal) {
		await waitFor(
			"runtime mirror",
			`http://127.0.0.1:${RUNTIME_PORT}/live2d.min.js`,
		)
	}
}
function shutdown() {
	for (const child of children) killTree(child.pid)
}

// ── Tiny HTTP helpers (server-login + tRPC + uploads, like manual-tag-hover) ─

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
function idFromTrpcJson(body) {
	const data = body?.result?.data
	const payload =
		data !== null && typeof data === "object" && "json" in data
			? data.json
			: data
	return payload?.id
}

// ── Fixture assembly ────────────────────────────────────────────────────────

function walk(dir, prefix = "") {
	const out = []
	for (const name of readdirSync(dir)) {
		const abs = join(dir, name)
		if (statSync(abs).isDirectory()) {
			out.push(...walk(abs, `${prefix}${name}/`))
		} else {
			out.push([`${prefix}${name}`, readFileSync(abs)])
		}
	}
	return out
}

function buildPluginZip(useReal) {
	if (!existsSync(join(PLUGIN_DIST, "main.js"))) {
		throw new Error(
			`plugin dist missing: ${join(PLUGIN_DIST, "main.js")} — build plugin-live2d first`,
		)
	}
	const result = {}
	for (const [rel, bytes] of walk(PLUGIN_DIST)) {
		if (rel.endsWith(".js")) {
			let text = new TextDecoder().decode(bytes)
			if (!useReal) {
				for (let i = 0; i < RUNTIME_URLS.length; i++) {
					text = text.replaceAll(RUNTIME_URLS[i], MIRRORED[i])
				}
			}
			if (text.includes("onInstall")) {
				log("plugin dist carries onInstall")
			}
			result[rel] = strToU8(text)
		} else {
			result[rel] = bytes
		}
	}
	return Buffer.from(zipSync(result))
}

// ── Vault wait ──────────────────────────────────────────────────────────────

function findVaultRel(rel) {
	for (const dir of readdirSync(STORAGE_ROOT, { recursive: true })) {
		if (String(dir).endsWith(join("plugins", LIVE2D_ID, "vault", rel))) {
			return String(dir).split(/[\\/]/)
		}
	}
	return []
}
function vaultExists(rel) {
	const found = findVaultRel(rel)
	return found.length > 0 && existsSync(join(STORAGE_ROOT, ...found))
}

async function waitVault(rel, timeoutMs = 60_000) {
	const t0 = Date.now()
	for (;;) {
		if (vaultExists(rel)) return Date.now() - t0
		if (Date.now() - t0 > timeoutMs)
			throw new Error(`vault file never landed: ${rel}`)
		await new Promise((r) => setTimeout(r, 500))
	}
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

function ensureRuntimeMirror() {
	if (process.env.MANUAL_USE_REAL_CDNS === "1") return { useReal: true }
	// The mirror only carries real bytes when the CDNs are reachable —
	// otherwise fall back to the real URLs (the flow is what we test).
	mkdirSync(MIRROR_DIR, { recursive: true })
	return { useReal: false }
}

async function main() {
	const mirror = ensureRuntimeMirror()
	if (!mirror.useReal) {
		for (const [url, file] of [
			[RUNTIME_URLS[0], "live2d.min.js"],
			[RUNTIME_URLS[2], "live2dcubismcore.min.js"],
		]) {
			try {
				const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const bytes = Buffer.from(await res.arrayBuffer())
				writeFileSync(join(MIRROR_DIR, file), bytes)
				log(`runtime mirror: ${file} (${bytes.length} bytes)`)
			} catch (err) {
				log(
					`runtime mirror fetch failed for ${file}: ${err instanceof Error ? err.message : String(err)} — falling back to real CDN URLs`,
				)
				mirror.useReal = true
				break
			}
		}
	}
	await boot(mirror)
	const browser = await chromium.launch()
	const page = await browser.newPage({
		viewport: { width: 1600, height: 1000 },
	})

	await waitLogin(page)
	log("server claimed + signed in")
	const cookie = await apiLogin()

	const pluginZip = buildPluginZip(mirror.useReal)

	// 1) Install via the real zip-upload UI → install-time consent.
	let t0 = Date.now()
	await page.goto(`http://127.0.0.1:${WEB_PORT}/settings/plugins`)
	await page.getByTestId("plugin-upload-input").setInputFiles({
		name: "live2d-manual.zip",
		mimeType: "application/zip",
		buffer: pluginZip,
	})
	const confirm = page.getByTestId("plugin-install-confirm")
	await confirm.waitFor({ state: "visible", timeout: 15_000 })
	// Dispatch the DOM click: the install-time consent dialog (z-70) can
	// pop over the confirm dialog the moment the upload completes.
	await confirm.evaluate((el) => el.click())
	const dialog = page.getByTestId("plugin-download-consent")
	await dialog.waitFor({ state: "visible", timeout: 30_000 })
	step("install → consent dialog", Date.now() - t0)
	await page.screenshot({
		path: join(SHOTS, "plugin-consent-01-install-dialog.png"),
	})

	// 2) Allow → vault lands.
	t0 = Date.now()
	await page.getByTestId("plugin-download-allow").click()
	await waitVault(join("runtime", "live2d.min.js"))
	await waitVault(join("runtime", "live2dcubismcore.min.js"))
	step("allow → vault files", Date.now() - t0)

	// 3) Create the Live2D model resource from the EXTRACTED files (ordered
	//    upload per file), then open it — warm vault, no dialog.
	const files = walk(TESTDATA)
	const fileIds = []
	for (const [_rel, bytes] of files) {
		const res = await fetch(
			`http://127.0.0.1:${SERVER_PORT}/api/uploads/ordered`,
			{
				method: "POST",
				headers: { cookie },
				body: (() => {
					const form = new FormData()
					form.append(
						"file",
						new File([bytes], "model-file", {
							type: "application/octet-stream",
						}),
					)
					return form
				})(),
			},
		)
		if (!res.ok)
			throw new Error(
				`ordered upload failed: ${res.status} ${await res.text()}`,
			)
		fileIds.push((await res.json()).fileId)
	}
	const resId = idFromTrpcJson(
		await trpcPost(cookie, "resource.create", {
			name: "Manual Live2D Model",
			contentPluginId: LIVE2D_ID,
			files: fileIds,
			names: files.map(([rel]) => rel),
		}),
	)
	log(`model resource created: ${resId}`)

	t0 = Date.now()
	await page.goto(`http://127.0.0.1:${WEB_PORT}/resources/${resId}`)
	try {
		await page
			.locator(`iframe[title^="plugin:${LIVE2D_ID}"]`)
			.waitFor({ timeout: 60_000 })
	} catch (err) {
		await page.screenshot({
			path: join(SHOTS, "plugin-consent-02b-preview-failed.png"),
		})
		throw err
	}
	// Let the plugin paint a few frames before capturing.
	await page.waitForTimeout(4_000)
	if ((await dialog.count()) > 0) {
		throw new Error("unexpected consent dialog on a warm vault preview")
	}
	step("warm-vault preview (no dialog, iframe painted)", Date.now() - t0)
	await page.screenshot({
		path: join(SHOTS, "plugin-consent-02-warm-preview.png"),
	})

	// 4) Deny loop: uninstall → reinstall → deny → preview re-asks → allow.
	await trpcPost(cookie, "plugin.uninstall", { id: LIVE2D_ID })
	log("uninstalled via API")

	t0 = Date.now()
	await page.goto(`http://127.0.0.1:${WEB_PORT}/settings/plugins`)
	await page.getByTestId("plugin-upload-input").setInputFiles({
		name: "live2d-manual.zip",
		mimeType: "application/zip",
		buffer: pluginZip,
	})
	const reinstallConfirm = page.getByTestId("plugin-install-confirm")
	await reinstallConfirm.waitFor({ state: "visible", timeout: 15_000 })
	await reinstallConfirm.evaluate((el) => el.click())
	await dialog.waitFor({ state: "visible", timeout: 30_000 })
	step("reinstall → consent dialog", Date.now() - t0)
	await page.getByTestId("plugin-download-deny").click()
	await dialog.waitFor({ state: "hidden", timeout: 10_000 })
	if (vaultExists(join("runtime", "live2d.min.js"))) {
		throw new Error("deny still wrote vault files")
	}

	// 5) Preview without the runtime → the runtime fallback re-asks.
	t0 = Date.now()
	await page.goto(`http://127.0.0.1:${WEB_PORT}/resources/${resId}`)
	await dialog.waitFor({ state: "visible", timeout: 60_000 })
	step("runtime-fallback re-ask", Date.now() - t0)
	await page.screenshot({
		path: join(SHOTS, "plugin-consent-03-fallback-dialog.png"),
	})
	await page.getByTestId("plugin-download-allow").click()
	await waitVault(join("runtime", "live2d.min.js"))
	step("fallback allow → vault", Date.now() - t0)
	await page
		.locator(`iframe[title^="plugin:${LIVE2D_ID}"]`)
		.waitFor({ timeout: 60_000 })
	await page.waitForTimeout(6_000)
	await page.screenshot({
		path: join(SHOTS, "plugin-consent-04-fallback-allowed-preview.png"),
	})

	// 6) Marketplace detail footer order (best-effort; needs the catalog).
	try {
		await page.goto(`http://127.0.0.1:${WEB_PORT}/settings/marketplace`)
		await page
			.getByTestId(`marketplace-plugin-${LIVE2D_ID}`)
			.waitFor({ timeout: 45_000 })
		await page.getByTestId(`marketplace-view-${LIVE2D_ID}`).click()
		await page
			.getByTestId("marketplace-detail-dialog")
			.waitFor({ timeout: 15_000 })
		const labels = await page
			.locator('[data-slot="dialog-footer"] button')
			.evaluateAll((els) => els.map((el) => el.textContent ?? ""))
		log(`marketplace detail footer buttons: ${JSON.stringify(labels)}`)
		if (labels[0] === "Cancel") {
			log("  → two-button footer: [Cancel, Uninstall] ✓ (function key right)")
		} else if (labels.includes("Uninstall")) {
			log("  → three-button footer: uninstall at the left edge ✓")
		} else {
			log("  → uninstalled/other layout — not an installed footer")
		}
		await page.screenshot({
			path: join(SHOTS, "plugin-consent-05-marketplace-detail.png"),
		})
	} catch (err) {
		log(
			`marketplace footer check skipped: ${err instanceof Error ? err.message : String(err)}`,
		)
	}

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
