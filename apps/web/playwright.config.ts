import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { defineConfig, devices } from "@playwright/test"

const devPorts: { spa: number } = JSON.parse(
	readFileSync(
		new URL("../../scripts/lib/dev-ports.json", import.meta.url),
		"utf8",
	),
)
const webPort = Number(process.env.WEB_PORT ?? devPorts.spa)
const serverPort = Number(process.env.SERVER_PORT ?? 3001)
const serverHost = "127.0.0.1"
// Ephemeral file per test run; wiped before the server boots so the web
// setup flow starts from an unconfigured server.
const dbPath = resolve(import.meta.dirname, ".playwright", "app-e2e.sqlite3")
const storageRoot = resolve(import.meta.dirname, ".playwright", "storage")
const testPassword = "correct horse battery staple"
const repoRoot = resolve(import.meta.dirname, "..", "..")

// The preview-window e2e spec drives a real gallery plugin iframe, so
// the e2e server loads the built plugin dist as a dev plugin. The dist is
// NOT built here on purpose — run `pnpm build:pkgs` once before test:e2e
// (or the plugin's own build when pointing E2E_PLUGIN_DIRS at an external
// plugin repo).
const devPluginDirs = (
	process.env.E2E_PLUGIN_DIRS ?? resolve(repoRoot, "plugins", "gallery", "dist")
)
	.split(",")
	.map((s) => s.trim())
	.filter((s) => s.length > 0)
for (const dir of devPluginDirs) {
	if (!existsSync(dir)) {
		throw new Error(
			`e2e plugin dist missing: ${dir}\nBuild it first (in-repo: \`pnpm build:pkgs\`), or point E2E_PLUGIN_DIRS at the built dists.`,
		)
	}
}

process.env.E2E_DB_PATH = dbPath
process.env.E2E_TEST_PASSWORD = testPassword
process.env.E2E_SERVER_PORT = String(serverPort)
process.env.E2E_WEB_PORT = String(webPort)

// Playwright loads this config in the main process and again in each worker;
// we only want to wipe the storage once, before webServer boots. The first
// test that reaches the login page claims the instance via the web setup.
function prepareStorage() {
	if (process.env.E2E_STORAGE_PREPARED === "1") return
	rmSync(dbPath, { force: true })
	rmSync(`${dbPath}-wal`, { force: true })
	rmSync(`${dbPath}-shm`, { force: true })
	rmSync(storageRoot, { recursive: true, force: true })
	mkdirSync(dirname(dbPath), { recursive: true })
	mkdirSync(storageRoot, { recursive: true })
	process.env.E2E_STORAGE_PREPARED = "1"
}

prepareStorage()

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? [["list"], ["html"]] : [["list"]],
	use: {
		baseURL: `http://127.0.0.1:${webPort}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		// Runs once before the main project: claims the unconfigured server
		// through the real web setup form (see e2e/claim.setup.ts).
		{ name: "setup", testMatch: /claim\.setup\.ts/ },
		{
			name: "chromium",
			dependencies: ["setup"],
			testIgnore: [/claim\.setup\.ts/],
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: [
		{
			command: `pnpm -F @hoardodile/server exec vite-node src/main.ts`,
			cwd: repoRoot,
			url: `http://${serverHost}:${serverPort}/health`,
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				NODE_ENV: "development",
				HOST: serverHost,
				PORT: String(serverPort),
				LOG_LEVEL: "warn",
				DATABASE_URL: dbPath,
				SESSION_COOKIE_NAME: "app_session_e2e",
				SESSION_SECURE_COOKIE: "false",
				STORAGE_ROOT: storageRoot,
				RESTART_ON_RESTORE: "false",
				DEV_PLUGIN_PATHS: devPluginDirs.join(","),
			},
		},
		{
			command: `pnpm -F @hoardodile/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
			cwd: repoRoot,
			url: `http://127.0.0.1:${webPort}`,
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: "pipe",
			stderr: "pipe",
			env: {
				VITE_SERVER_URL: `http://${serverHost}:${serverPort}`,
			},
		},
	],
})
