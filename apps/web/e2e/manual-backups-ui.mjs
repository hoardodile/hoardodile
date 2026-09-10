/**
 * Manual (screenshot-driven) verification of the redesigned backups surfaces,
 * driven against a throwaway stack this script boots itself:
 *
 *   - recovery points render as plugin-style cards (no disclosure triangles)
 *   - the automatic-backup frequency picker persists a new cadence
 *   - retention policy, repository checks and cleanup each open ONE dialog
 *   - the card More menu drives edit/compare/drill/remove
 *   - the pairing invitation's Details button expands inline
 *   - the maintenance screen reveals the restore list behind a button
 *   - STORM WATCH: after a real restore, a real 5-minute scheduler tick must
 *     NOT create another automatic recovery point (the interval is daily)
 *
 * Not part of the automated suite (AGENTS.md keeps e2e to critical-path
 * smoke) — captures evidence into
 * `.playwright/manual-screenshots/backups-*.png` and prints a timeline.
 *
 * Skipped on purpose (covered by jsdom tests instead): the LAN section's
 * "other addresses" dialog needs the desktop bridge, and the job list's
 * "Technical details" dialog needs a failed job.
 *
 * Usage (from apps/web, after `pnpm build:pkgs`):
 *   node e2e/manual-backups-ui.mjs
 *
 * Env: MANUAL_SERVER_PORT 3000, MANUAL_WEB_PORT 5173,
 *      MANUAL_SKIP_STORM_WATCH=1 (skip the ~6 minute tick watch).
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(__dirname, "..")
const REPO_ROOT = resolve(WEB_DIR, "..", "..")
const SERVER_PORT = Number(process.env.MANUAL_SERVER_PORT ?? 3000)
const WEB_PORT = Number(process.env.MANUAL_WEB_PORT ?? 5173)
const PASSWORD = "correct horse battery staple"
const SERVER = `http://127.0.0.1:${SERVER_PORT}`
const WEB = `http://127.0.0.1:${WEB_PORT}`
const TRPC = `${SERVER}/trpc`
const SKIP_STORM_WATCH = process.env.MANUAL_SKIP_STORM_WATCH === "1"

const STATE = resolve(WEB_DIR, ".playwright")
const STORAGE_ROOT = join(STATE, "manual-backups-storage")
const DB_PATH = join(STATE, "manual-backups.sqlite3")
const SHOTS = join(STATE, "manual-screenshots")

mkdirSync(SHOTS, { recursive: true })
rmSync(STORAGE_ROOT, { recursive: true, force: true })
rmSync(`${DB_PATH}-wal`, { force: true })
rmSync(`${DB_PATH}-shm`, { force: true })
rmSync(DB_PATH, { force: true })

// ── Boot the throwaway stack ────────────────────────────────────────────────

const children = []
function log(message) {
	console.log(`[manual] ${message}`)
}
/** Every child writes its stdout+stderr to an evidence log next to the shots. */
function spawnChild(name, cmd, args, env) {
	const output = openSync(join(STATE, `manual-backups-${name}.log`), "w")
	const child = spawn(cmd, args, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		stdio: ["ignore", output, output],
		windowsHide: true,
		shell: cmd === "pnpm",
	})
	child.on("error", (error) => log(`${name} spawn error: ${String(error)}`))
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
function shutdown() {
	for (const child of children) killTree(child.pid)
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
		SESSION_COOKIE_NAME: "app_session_manual_backups",
		SESSION_SECURE_COOKIE: "false",
		STORAGE_ROOT,
		BACKUP_ROOT: join(STORAGE_ROOT, "backups"),
		RESTART_ON_RESTORE: "false",
		// Dev plugins would block complete backups; the throwaway library needs
		// none of them.
		DISABLE_DEV_PLUGINS: "true",
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
	{ VITE_SERVER_URL: SERVER },
)

async function waitFor(label, url, timeoutMs = 90_000) {
	const started = Date.now()
	for (;;) {
		try {
			const response = await fetch(url)
			if (response.ok) return Date.now() - started
		} catch {
			// not up yet
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(`${label} did not come up: ${url}`)
		await new Promise((done) => setTimeout(done, 500))
	}
}

// ── API helpers ─────────────────────────────────────────────────────────────

function unwrap(body) {
	const data = body?.result?.data
	return data !== null && typeof data === "object" && "json" in data
		? data.json
		: data
}
function idFrom(body) {
	return unwrap(body)?.id
}
async function apiLogin() {
	const response = await fetch(`${SERVER}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password: PASSWORD }),
	})
	const setCookie = response.headers.get("set-cookie")
	if (setCookie === null) throw new Error("login: no cookie")
	return setCookie.split(";")[0]
}
async function trpcPost(cookie, procedure, data) {
	const response = await fetch(`${TRPC}/${procedure}`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify(data),
	})
	const body = await response.json()
	if (!response.ok || body?.error) {
		throw new Error(
			`${procedure} failed: ${response.status} ${JSON.stringify(body)}`,
		)
	}
	return body
}
async function trpcGet(cookie, procedure, input) {
	const url = new URL(`${TRPC}/${procedure}`)
	if (input !== undefined) url.searchParams.set("input", JSON.stringify(input))
	const response = await fetch(url, { headers: { cookie } })
	if (!response.ok) {
		throw new Error(`${procedure} GET failed: ${response.status}`)
	}
	return unwrap(await response.json())
}

/** Wait for a protection job to settle; throws when it failed. */
async function waitJob(cookie, id, timeoutMs = 120_000) {
	const started = Date.now()
	for (;;) {
		const job = await trpcGet(cookie, "protection.job", { id })
		if (
			job &&
			["succeeded", "failed", "cancelled", "interrupted"].includes(job.state)
		) {
			if (job.state !== "succeeded") {
				throw new Error(`job ${id} ended ${job.state}: ${job.error?.message}`)
			}
			return job
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(`job ${id} did not settle in ${timeoutMs} ms`)
		await new Promise((done) => setTimeout(done, 500))
	}
}

const protectionStatus = (cookie) => trpcGet(cookie, "protection.status")
const protectionPoints = (cookie) =>
	trpcGet(cookie, "protection.points", { repositoryId: "local" })

/** Newest protection job of a kind (job.list() arrives newest first). */
async function latestJob(cookie, kind) {
	const jobs = await trpcGet(cookie, "protection.jobs")
	if (!Array.isArray(jobs)) return undefined
	return jobs.find((job) => job.kind === kind)
}

async function backup(cookie, input, attempts = 3) {
	for (let attempt = 1; ; attempt++) {
		const id = idFrom(await trpcPost(cookie, "protection.backup", input))
		if (typeof id !== "string") throw new Error("protection.backup: no job id")
		try {
			await waitJob(cookie, id)
			return
		} catch (error) {
			// The restic engine's first-run cold start can fail once (the e2e
			// spec retries the same race) — retry before giving up.
			if (attempt >= attempts) throw error
			log(`backup attempt ${attempt} failed (${error.message}); retrying`)
			await new Promise((done) => setTimeout(done, 2000))
		}
	}
}

async function waitForValue(label, read, predicate, timeoutMs = 60_000) {
	const started = Date.now()
	let last
	for (;;) {
		last = await read()
		if (predicate(last)) return last
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`${label} did not settle: ${JSON.stringify(last).slice(0, 400)}`,
			)
		}
		await new Promise((done) => setTimeout(done, 1000))
	}
}

async function waitForText(locator, text, timeoutMs = 30_000) {
	const started = Date.now()
	let seen = ""
	for (;;) {
		seen = await locator.innerText().catch(() => "")
		if (seen.includes(text)) return seen
		if (Date.now() - started > timeoutMs) {
			throw new Error(`"${text}" never appeared (saw "${seen}")`)
		}
		await new Promise((done) => setTimeout(done, 500))
	}
}

// ── UI helpers ──────────────────────────────────────────────────────────────

const CARDS =
	'[data-testid^="recovery-point-"]:not([data-testid^="recovery-point-menu-"])'
const timeline = []
async function shot(page, name, fullPage = true) {
	const path = join(SHOTS, name)
	// Dialogs and menus fade in over ~240 ms; let the enter motion land and
	// disable animations so the evidence shows the settled surface.
	await page.waitForTimeout(350)
	await page.screenshot({ path, fullPage, animations: "disabled" })
	timeline.push(name)
	log(`screenshot ${name}`)
}
function step(name) {
	log(`── ${name}`)
}

async function waitLogin(page) {
	await page.goto(WEB, { timeout: 120_000 })
	await page.waitForURL(/\/login$/, { timeout: 60_000 })
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

/** Create the first backup through the real setup wizard, tolerating one
    intermittent cold-start failure (same retry the e2e spec uses). */
async function setupFirstBackup(page) {
	await page.getByTestId("setup-new-backup").click()
	await page.getByTestId("initialize-backups").click()
	const retry = page
		.getByTestId("recent-operations-section")
		.getByRole("button", { name: "Retry" })
	for (let attempt = 0; attempt < 5; attempt++) {
		const visible = await page
			.locator(CARDS)
			.first()
			.waitFor({ state: "visible", timeout: 45_000 })
			.then(() => true)
			.catch(() => false)
		if (visible) return
		if (await retry.count()) await retry.first().click()
	}
	throw new Error("the first backup never produced a recovery point card")
}

async function openCardMenu(page) {
	const card = page.locator(CARDS).first()
	await card.getByRole("button", { name: "Advanced backup actions" }).click()
	return card
}

async function main() {
	await waitFor("app server", `${SERVER}/health`)
	await waitFor("spa", WEB)
	log("stack up")

	const browser = await chromium.launch()
	const page = await browser.newPage({
		viewport: { width: 1600, height: 1000 },
	})
	page.on("pageerror", (error) => log(`page error: ${String(error)}`))
	await waitLogin(page)
	const cookie = await apiLogin()
	log("claimed + signed in")

	step("1. first backup through the setup wizard")
	await page.goto(`${WEB}/settings/backups`)
	await setupFirstBackup(page)
	log("first recovery point exists")

	step("2. seed recovery points (2 manual pinned + 5 automatic) via the API")
	for (let index = 1; index <= 2; index++) {
		await backup(cookie, {
			name: `manual-seed-${index}`,
			note: "Seeded for the manual verification",
			kind: "manual",
			pinned: true,
		})
	}
	for (let index = 1; index <= 5; index++) {
		await backup(cookie, { name: "", note: "", kind: "auto", pinned: false })
	}
	const seeded = await protectionPoints(cookie)
	log(
		`seeded points: ${seeded.length} (automatic ${seeded.filter((p) => p.kind === "auto").length})`,
	)
	await page.reload()
	await page.locator(CARDS).first().waitFor({ timeout: 30_000 })
	await waitForValue(
		"card grid",
		() => page.locator(CARDS).count(),
		(count) => count === seeded.length,
		30_000,
	)
	await shot(page, "backups-01-card-grid.png")

	step("3. automatic backup frequency")
	await page.getByTestId("backup-frequency").click()
	await page.getByRole("menuitemradio", { name: "Every 6 hours" }).waitFor()
	await shot(page, "backups-02-frequency-menu.png", false)
	await page.getByRole("menuitemradio", { name: "Every 6 hours" }).click()
	await waitForValue(
		"interval=6",
		() => protectionStatus(cookie).then((s) => s.autoBackupIntervalHours),
		(hours) => hours === 6,
	)
	await page.reload()
	await waitForText(page.getByTestId("backup-frequency"), "Every 6 hours")
	const persisted = await page.getByTestId("backup-frequency").innerText()
	log(`frequency after reload: ${persisted.trim()}`)
	await page.getByTestId("backup-frequency").click()
	await page.getByRole("menuitemradio", { name: "Daily" }).click()
	await waitForValue(
		"interval back to 24",
		() => protectionStatus(cookie).then((s) => s.autoBackupIntervalHours),
		(hours) => hours === 24,
	)
	await shot(page, "backups-03-frequency-daily.png")

	step("4. retention policy dialog")
	await page.getByTestId("backup-retention").click()
	const retention = page.getByRole("dialog")
	await retention.waitFor()
	await shot(page, "backups-04-retention-dialog.png", false)
	await retention.locator("#backup-policy-automatic").fill("2")
	await retention.getByRole("button", { name: "Save" }).click()
	await waitForValue(
		"policy.automatic=2",
		() => protectionStatus(cookie).then((s) => s.policy.automatic),
		(count) => count === 2,
	)
	await page.getByTestId("backup-retention").click()
	await retention.waitFor()
	await shot(page, "backups-05-retention-saved.png", false)
	await retention.locator("#backup-policy-automatic").fill("3")
	await retention.getByRole("button", { name: "Save" }).click()
	await waitForValue(
		"policy.automatic=3",
		() => protectionStatus(cookie).then((s) => s.policy.automatic),
		(count) => count === 3,
	)

	step("5. repository checks dialog")
	await page.getByTestId("backup-checks").click()
	await page.getByRole("dialog").waitFor()
	await shot(page, "backups-06-checks-dialog.png", false)
	await page.keyboard.press("Escape")

	step("6. cleanup of expired automatic points")
	// The daily maintenance tick may already have pruned to the policy
	// count; top the automatic points back up so the UI cleanup has work to
	// do and the outcome is deterministic.
	const points = await protectionPoints(cookie)
	let automaticBefore = points.filter((point) => point.kind === "auto").length
	while (automaticBefore < 5) {
		await backup(cookie, { name: "", note: "", kind: "auto", pinned: false })
		automaticBefore += 1
	}
	log(`automatic points before cleanup: ${automaticBefore}`)
	await page.getByTestId("backup-cleanup").click()
	const cleanupDialog = page.getByRole("dialog")
	await cleanupDialog.waitFor()
	const cleanupConfirm = cleanupDialog.getByRole("button", {
		name: "Remove expired points",
	})
	// The preview is a repository read; the confirm stays disabled until it
	// lands, so wait for the list before capturing the evidence.
	await waitForValue(
		"cleanup preview",
		() => cleanupConfirm.isEnabled(),
		(enabled) => enabled,
		60_000,
	)
	await shot(page, "backups-07-cleanup-preview.png", false)
	await cleanupConfirm.click()
	// Watch the cleanup job itself: a job that never leaves "queued" means the
	// confirmation was accepted but the server never ran it.
	const retentionJob = await waitForValue(
		"retention job",
		() => latestJob(cookie, "retention"),
		(job) =>
			job !== undefined &&
			!["queued", "running", "cancelling"].includes(job.state),
		120_000,
	)
	if (retentionJob.state !== "succeeded") {
		throw new Error(
			`retention job ${retentionJob.state}: ${retentionJob.error?.message ?? "no error message"}`,
		)
	}
	const after = await waitForValue(
		"automatic points pruned to 3",
		() => protectionPoints(cookie),
		(points) => points.filter((point) => point.kind === "auto").length === 3,
	)
	const automaticAfter = after.filter((point) => point.kind === "auto").length
	const manualAfter = after.filter((point) => point.kind === "manual").length
	log(
		`retention: automatic ${automaticBefore} → ${automaticAfter}, manual kept ${manualAfter}, total ${after.length}`,
	)
	if (automaticBefore !== 5 || automaticAfter !== 3 || manualAfter !== 3) {
		throw new Error(
			`unexpected retention outcome: ${automaticBefore} → ${automaticAfter} automatic, ${manualAfter} manual`,
		)
	}
	await waitForValue(
		"card grid after cleanup",
		() => page.locator(CARDS).count(),
		(count) => count === after.length,
		30_000,
	)
	await shot(page, "backups-08-cleanup-applied.png")

	step("7. card tools menu")
	await openCardMenu(page)
	await page.getByRole("menuitem", { name: "Edit details" }).waitFor()
	await shot(page, "backups-09-card-menu.png", false)
	await page.getByRole("menuitem", { name: "Edit details" }).click()
	const metadata = page.getByRole("dialog")
	await metadata.waitFor()
	await metadata.getByLabel("Name").fill("manual-verify-renamed")
	await metadata.getByRole("button", { name: "Save" }).click()
	await page.getByText("manual-verify-renamed").first().waitFor()
	await shot(page, "backups-10-metadata-saved.png")
	await openCardMenu(page)
	await page.getByRole("menuitem", { name: "Compare files" }).click()
	await page.getByText("File comparison").first().waitFor({ timeout: 60_000 })
	await shot(page, "backups-11-compare-expanded.png")
	await openCardMenu(page)
	await page.getByRole("menuitem", { name: "Recovery drill" }).click()
	await page.getByRole("dialog").waitFor()
	await shot(page, "backups-12-drill-dialog.png", false)
	await page.keyboard.press("Escape")
	await openCardMenu(page)
	await page.getByRole("menuitem", { name: "Remove" }).click()
	await page.getByRole("dialog").waitFor()
	await shot(page, "backups-13-delete-confirm.png", false)
	await page.keyboard.press("Escape")

	step("8. pairing invitation details")
	// A fresh install has no sync role yet: choosing "share this device's
	// backups" confirms through its own dialog before the invite button shows.
	const chooseSend = page.getByTestId("setup-sync-send")
	if (await chooseSend.count()) {
		await chooseSend.click()
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click()
	}
	const invite = page.getByRole("button", {
		name: "Create pairing invitation",
	})
	await invite.waitFor({ timeout: 30_000 })
	await invite.click()
	await page.getByRole("dialog").waitFor()
	await page.getByTestId("replication-details").click()
	await page.getByLabel("Pairing code").waitFor()
	await shot(page, "backups-14-pairing-details.png", false)
	await page.keyboard.press("Escape")

	step("9. restore → maintenance screen button")
	await page
		.locator(CARDS)
		.first()
		.getByRole("button", { name: "Restore" })
		.click()
	const confirmation = page.getByTestId("full-restore-confirm")
	await confirmation.waitFor({ timeout: 60_000 })
	await confirmation.fill("RESTORE")
	await page.getByTestId("full-restore-submit").click()
	await page.getByTestId("library-maintenance").waitFor({ timeout: 30_000 })
	await page.getByTestId("choose-another-backup").click()
	await page.getByTestId("available-backups-section").waitFor({
		timeout: 30_000,
	})
	await shot(page, "backups-15-maintenance-expand.png")
	// A job record write can fail with a transient Windows EPERM (the web dev
	// server watches this throwaway storage), which leaves the accepted
	// restore job "queued" and the library in maintenance. The maintenance
	// screen's Retry re-runs it — assert that path rather than hanging.
	const waitRestored = (timeoutMs) =>
		page
			.getByTestId("library-maintenance")
			.waitFor({ state: "hidden", timeout: timeoutMs })
			.then(() => true)
			.catch(() => false)
	let restored = await waitRestored(90_000)
	if (!restored) {
		const retry = page
			.getByTestId("recent-operations-section")
			.getByRole("button", { name: "Retry" })
		if (await retry.count()) {
			log("restore stalled (see the server log) — retrying from the screen")
			await retry.first().click()
			restored = await waitRestored(150_000)
		}
	}
	if (!restored) {
		log(
			"WARNING: the restore never finished — skipping the storm watch (the library stays in maintenance, where the scheduler is paused)",
		)
	} else {
		log("restore finished")
		await page.getByTestId("app-sidebar").waitFor({ timeout: 30_000 })
	}

	step(
		"10. storm watch — one real scheduler tick must not add an automatic point",
	)
	const initialStatus = await protectionStatus(cookie)
	const initialPoints = await protectionPoints(cookie)
	log(
		`interval ${initialStatus.autoBackupIntervalHours} h, last automatic backup ${initialStatus.lastAutoBackupAt}, automatic points ${initialPoints.filter((p) => p.kind === "auto").length}`,
	)
	if (SKIP_STORM_WATCH || !restored) {
		log("storm watch skipped")
	} else {
		const samples = []
		const started = Date.now()
		// The scheduler polls every 5 minutes from server boot; 6.5 minutes of
		// watching always spans at least one tick of a run this length.
		while (Date.now() - started < 6.5 * 60_000) {
			await new Promise((done) => setTimeout(done, 30_000))
			const status = await protectionStatus(cookie)
			const points = await protectionPoints(cookie)
			const automatic = points.filter((point) => point.kind === "auto").length
			samples.push({ automatic, lastAutoBackupAt: status.lastAutoBackupAt })
			log(
				`watch ${Math.round((Date.now() - started) / 1000)}s: automatic ${automatic}, last automatic ${status.lastAutoBackupAt}`,
			)
		}
		const grown = samples.filter(
			(sample) =>
				sample.automatic !==
				initialPoints.filter((p) => p.kind === "auto").length,
		)
		if (grown.length > 0) {
			throw new Error(
				`the scheduler created automatic points during the watch: ${JSON.stringify(samples)}`,
			)
		}
		log(`storm watch clean across ${samples.length} samples`)
	}

	console.log("\n=== timeline ===")
	for (const line of timeline) console.log(line)
	console.log("\nscreenshots:", SHOTS)
	for (const name of timeline) {
		if (!existsSync(join(SHOTS, name))) throw new Error(`missing ${name}`)
	}
	await browser.close()
}

try {
	await main()
} finally {
	shutdown()
}
