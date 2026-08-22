#!/usr/bin/env node
/**
 * One-command desktop dev loop: `pnpm desktop`.
 *
 * Default ports come from `scripts/lib/dev-ports.json` (change them there,
 * not here): the SPA default, the wizard default, and the API relay.
 * - SPA: reuses an already-running hoardodile Vite (`pnpm dev` on the SPA
 *   port) when detected; otherwise starts an in-process Vite on the first
 *   free port at or above it. Owned servers bind 127.0.0.1 explicitly —
 *   Vite's default `localhost` binding may resolve to ::1 only and leave
 *   IPv4 unreachable.
 * - Wizard: in-process Vite on the first free port at or above the wizard
 *   default (the wizard config pins it with strictPort, which fails when
 *   occupied).
 * - Electron: spawned with HOARDODILE_WEB_URL / ELECTRON_WIZARD_URL /
 *   HOARDODILE_WORKSPACE; stopped as a process tree so the vite-node sidecar
 *   it spawned does not outlive a Ctrl+C.
 * - HOARDODILE_WEB_URL: explicit SPA to reuse; the script waits for it and
 *   fails fast with a clear message instead of the in-app Retry dialog.
 * - API relay: when the script owns the SPA it points the SPA's own
 *   proxy target (`VITE_SERVER_URL`, default 127.0.0.1:3000 where nothing
 *   listens in the desktop flow) at a live 503 responder. API calls from
 *   the desktop window reach the sidecar through main's dest proxy; this
 *   relay only prevents ECONNREFUSED noise from browser tabs and from
 *   requests that race the proxy install after the window opens.
 */
import { spawn } from "node:child_process"
import { setDefaultResultOrder } from "node:dns"
import { existsSync, readFileSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import getPort from "get-port"
import { build, createServer } from "vite"

setDefaultResultOrder("ipv4first")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(root, "../..")
const webRoot = resolve(workspaceRoot, "apps", "web")
const require = createRequire(import.meta.url)
const electronExe = require("electron")
const devPorts = JSON.parse(
	readFileSync(
		new URL("../../../scripts/lib/dev-ports.json", import.meta.url),
		"utf8",
	),
)

/**
 * Vite dev serves app sources as transformed modules; only a hoardodile web
 * checkout has this file, and any other Vite SPA fallback answers `text/html`.
 */
const SPA_PROBE = `http://localhost:${devPorts.spa}/src/routeTree.gen.ts`
const SPA_REUSE_URL = `http://localhost:${devPorts.spa}`

async function main() {
	ensurePluginDists()
	const spa = await resolveSpa()
	const wizard = await startWizard()

	await build({ configFile: resolve(root, "vite.main.config.ts") })
	await build({ configFile: resolve(root, "vite.preload.config.ts") })

	const child = spawn(electronExe, [root], {
		cwd: root,
		stdio: "inherit",
		env: {
			...process.env,
			ELECTRON_WIZARD_URL: wizard.url,
			HOARDODILE_WEB_URL: spa.url,
			HOARDODILE_WORKSPACE: workspaceRoot,
		},
	})
	console.log(
		`[desktop] electron started (pid ${String(child.pid)}) — Ctrl+C stops everything`,
	)
	registerShutdown(child, [
		wizard.server,
		...(spa.owned ? [spa.server, spa.relay] : []),
	])
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

async function resolveSpa() {
	const explicit = process.env.HOARDODILE_WEB_URL
	if (explicit !== undefined && explicit.length > 0) {
		console.log(`[desktop] waiting for HOARDODILE_WEB_URL ${explicit}`)
		await waitForHttp(
			explicit,
			20_000,
			`SPA at ${explicit} did not become reachable (is it running?)`,
		)
		return { url: explicit, owned: false, server: undefined, relay: undefined }
	}
	if (await isHoardodileSpa(SPA_PROBE)) {
		console.log(
			`[desktop] reusing SPA at ${SPA_REUSE_URL} (started by \`pnpm dev\`)`,
		)
		return {
			url: SPA_REUSE_URL,
			owned: false,
			server: undefined,
			relay: undefined,
		}
	}
	const relay = await startApiRelay()
	// The desktop flow serves the SPA's API through main's dest proxy; the
	// SPA's own proxy target only exists so requests land on a live server
	// instead of an ECONNREFUSED 127.0.0.1:3000.
	process.env.VITE_SERVER_URL = relay.url
	const port = await getPort({ host: "127.0.0.1", port: devPorts.spa })
	const url = `http://127.0.0.1:${port}`
	const server = await createServer({
		configFile: resolve(webRoot, "vite.config.ts"),
		// The web config declares no `root`; without one Vite would serve the
		// script's cwd (apps/desktop). Other fields merge from the config file.
		root: webRoot,
		server: { host: "127.0.0.1", port, strictPort: true },
	})
	await server.listen()
	await waitForHttp(`${url}/`, 20_000, `SPA at ${url} did not start`)
	console.log(`[desktop] started SPA at ${url} (api relay ${relay.url})`)
	return { url, owned: true, server, relay }
}

async function startApiRelay() {
	const port = await getPort({ host: "127.0.0.1", port: devPorts.relay })
	const url = `http://127.0.0.1:${port}`
	const server = createHttpServer((_req, res) => {
		res.writeHead(503, { "content-type": "application/json" })
		res.end(
			JSON.stringify({
				error:
					"hoardodile API is served by the desktop window (sidecar proxy); browser tabs get no data",
			}),
		)
	})
	return new Promise((promiseResolve, promiseReject) => {
		server.once("error", promiseReject)
		server.listen(port, "127.0.0.1", () => {
			promiseResolve({ url, server })
		})
	})
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

async function isHoardodileSpa(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
		return (res.headers.get("content-type") ?? "").startsWith("text/javascript")
	} catch {
		return false
	}
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
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1_000) })
			if (res.ok) return
		} catch {
			// not listening yet
		}
		await delay(150)
	}
	throw new Error(message)
}

main().catch((err) => {
	console.error(`[desktop] ${err instanceof Error ? err.message : String(err)}`)
	process.exit(1)
})
