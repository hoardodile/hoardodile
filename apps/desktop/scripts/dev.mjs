#!/usr/bin/env node
/**
 * Desktop dev loop: `pnpm desktop` — independent of `pnpm dev`.
 *
 * Desktop and web dev are separate: this script NEVER starts or owns the
 * SPA, and does not wait for one or fail without it. It simply launches
 * Electron against the SPA URL (`pnpm dev`'s default, or explicit
 * `HOARDODILE_WEB_URL`); if nothing answers, the shell window shows its
 * own Retry page until the SPA comes up (start `pnpm dev`, press Retry).
 *
 * Default ports come from `scripts/lib/dev-ports.json` (change them there,
 * not here): the SPA default and the wizard default.
 * - Wizard: in-process Vite on the first free port at or above the wizard
 *   default (the wizard config pins it with strictPort, which fails when
 *   occupied).
 * - Electron: spawned with HOARDODILE_WEB_URL / ELECTRON_WIZARD_URL /
 *   HOARDODILE_WORKSPACE; stopped as a process tree so the vite-node sidecar
 *   it spawned does not outlive a Ctrl+C. The backend (Fastify sidecar) is
 *   spawned by the shell itself — no external backend required.
 * - API routing in the desktop window is main's dest proxy
 *   (`apps/desktop/src/main/dest-api-proxy.ts`); the SPA's own `VITE_SERVER_URL`
 *   proxy target is never touched here.
 */
import { spawn } from "node:child_process"
import { setDefaultResultOrder } from "node:dns"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import getPort from "get-port"
import { build, createServer } from "vite"

setDefaultResultOrder("ipv4first")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(root, "../..")
const require = createRequire(import.meta.url)
const electronExe = require("electron")
const devPorts = JSON.parse(
	readFileSync(
		new URL("../../../scripts/lib/dev-ports.json", import.meta.url),
		"utf8",
	),
)

/**
 * Vite dev serves app sources as transformed modules; when the user reuses
 * the default port the desktop window talks to whatever answers there.
 */
const SPA_REUSE_URL = `http://localhost:${devPorts.spa}`

async function main() {
	ensurePluginDists()
	const spaUrl = resolveSpaUrl()
	const wizard = await startWizard()

	await build({ configFile: resolve(root, "vite.main.config.ts") })
	await build({ configFile: resolve(root, "vite.preload.config.ts") })

	const child = spawn(electronExe, [root], {
		cwd: root,
		stdio: "inherit",
		env: {
			...process.env,
			ELECTRON_WIZARD_URL: wizard.url,
			HOARDODILE_WEB_URL: spaUrl,
			HOARDODILE_WORKSPACE: workspaceRoot,
		},
	})
	console.log(
		`[desktop] electron started (pid ${String(child.pid)}) — Ctrl+C stops everything`,
	)
	registerShutdown(child, [wizard.server])
}

/**
 * The sidecar loads the builtin file plugin and the seeded gallery from
 * workspace dists; without them the server aborts at startup and the app
 * just lands in the tray's crashed state. Fail fast with the fix instead.
 */
function ensurePluginDists() {
	const builtin = resolve(
		workspaceRoot,
		"plugins",
		"file",
		"dist",
		"manifest.json",
	)
	if (!existsSync(builtin)) {
		throw new Error(
			`builtin plugin dist missing (${builtin}) — run \`pnpm build:pkgs\` first`,
		)
	}
	const gallery = resolve(
		workspaceRoot,
		"plugins",
		"gallery",
		"dist",
		"manifest.json",
	)
	if (!existsSync(gallery)) {
		console.warn(
			"[desktop] gallery dist missing — run `pnpm build:pkgs` to preview the gallery",
		)
	}
}

/**
 * The URL the desktop window loads in dev: `HOARDODILE_WEB_URL` when set,
 * otherwise the SPA default. No probe, no wait, no failure — if nothing
 * answers, the shell window shows its Retry page instead of blocking the
 * launch (start `pnpm dev` later, press Retry inside the window).
 */
function resolveSpaUrl() {
	const explicit = process.env.HOARDODILE_WEB_URL
	if (explicit !== undefined && explicit.length > 0) {
		return explicit
	}
	return SPA_REUSE_URL
}

async function startWizard() {
	const port = await getPort({ host: "127.0.0.1", port: devPorts.wizard })
	const url = `http://127.0.0.1:${port}`
	const server = await createServer({
		configFile: resolve(root, "vite.wizard.config.ts"),
		server: {
			host: "127.0.0.1",
			port,
			strictPort: true,
			origin: url,
		},
	})
	await server.listen()
	await waitForHttp(`${url}/`, 15_000, `wizard at ${url} did not start`)
	console.log(`[desktop] wizard at ${url}/`)
	return { url: `${url}/`, server }
}

function registerShutdown(child, servers) {
	let stopping = false
	const stop = async () => {
		if (stopping) return
		stopping = true
		await Promise.all(servers.map((server) => server.close()))
		if (child.pid !== undefined && child.exitCode === null) {
			if (process.platform === "win32") {
				// Tree-kill so the sidecar the main process spawned dies too.
				spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
					stdio: "ignore",
				})
			} else {
				child.kill()
			}
		}
	}
	process.on("SIGINT", () => {
		void stop().then(() => process.exit(130))
	})
	process.on("SIGTERM", () => {
		void stop().then(() => process.exit(143))
	})
	child.on("exit", (code) => {
		void Promise.all(servers.map((server) => server.close())).then(() => {
			process.exit(code ?? 0)
		})
	})
}

async function waitForHttp(url, timeoutMs, message) {
	await waitFor(
		async () => {
			try {
				const res = await fetch(url, { signal: AbortSignal.timeout(1_000) })
				return res.ok
			} catch {
				return false
			}
		},
		timeoutMs,
		message,
	)
}

async function waitFor(predicate, timeoutMs, message) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await delay(150)
	}
	throw new Error(message)
}

main().catch((err) => {
	console.error(`[desktop] ${err instanceof Error ? err.message : String(err)}`)
	process.exit(1)
})
