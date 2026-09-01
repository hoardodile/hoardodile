import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import getPort from "get-port"
import type { DesktopConfig } from "./config.ts"
import type { SidecarLayout } from "./paths.ts"
import {
	buildSidecarEnv,
	createShutdownToken,
	type SidecarHost,
} from "./spawn-env.ts"

const HEALTH_TIMEOUT_MS = 180_000
const HEALTH_POLL_MS = 150
const SHUTDOWN_TIMEOUT_MS = 15_000
const MAX_START_ATTEMPTS = 3

export type SidecarHandle = {
	readonly port: number
	readonly url: string
	readonly shutdownToken: string
	stop: () => Promise<void>
	onCrash: (listener: () => void) => () => void
}

export type StartSidecarOptions = {
	readonly layout: SidecarLayout
	readonly config: DesktopConfig
	readonly persistPort: (port: number) => void
	readonly log: (chunk: string) => void
}

/**
 * The sidecar always binds loopback. LAN exposure is served by the
 * shell's embedded TLS terminator (see lan-proxy.ts) instead of rebinding
 * the sidecar to `0.0.0.0`, so toggling the share never restarts it.
 *
 * Exported so tests can pin the loopback invariant.
 */
export function sidecarHost(_config: DesktopConfig): SidecarHost {
	return "127.0.0.1"
}

/**
 * Whether a fresh `listen` on `port` would succeed right now. An in-place
 * sidecar restart (LAN toggle, resource-swap apply) usually reuses the same
 * port, but its predecessor's sockets linger briefly between stop and
 * rebind (e.g. TIME_WAIT on Windows). `get-port`'s availability probe does
 * not survive that linger and reports the port busy, which silently drifts
 * the listening port. A real `listen` on the same host/port *does* succeed
 * through the linger (Node binds with SO_REUSEADDR), so probe the actual
 * bind semantics instead of relying on `get-port`'s check.
 */
export async function resolveListenPort(
	host: SidecarHost,
	preferredPort: number,
): Promise<number> {
	if (await canBind(host, preferredPort)) return preferredPort
	return await getPort({ host })
}

async function canBind(host: SidecarHost, port: number): Promise<boolean> {
	const server = createServer()
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject)
			server.listen({ host, port }, () => resolve())
		})
		return true
	} catch {
		return false
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
}

export async function startSidecar(
	options: StartSidecarOptions,
): Promise<SidecarHandle> {
	let lastError: Error | undefined
	let preferredPort = options.config.port
	const host = sidecarHost(options.config)
	for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
		try {
			return await spawnSidecarOnce(options, preferredPort, host)
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err))
			if (attempt === MAX_START_ATTEMPTS) break
			preferredPort = await getPort({ host })
		}
	}
	throw lastError ?? new Error("sidecar failed to start")
}

async function spawnSidecarOnce(
	options: StartSidecarOptions,
	preferredPort: number,
	host: SidecarHost,
): Promise<SidecarHandle> {
	const port = await resolveListenPort(host, preferredPort)
	if (port !== options.config.port) options.persistPort(port)
	const shutdownToken = createShutdownToken()
	const env = buildSidecarEnv({
		layout: options.layout,
		libraryPath: options.config.libraryPath,
		host,
		port,
		sharedFolderRoot: options.config.sharedFolderRoot,
		sharedFolderEnabled: options.config.sharedFolderEnabled,
		shutdownToken,
		webRoot: options.layout.webRoot,
	})
	const child = spawn(options.layout.nodePath, [...options.layout.serverArgs], {
		cwd: options.layout.cwd,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	})
	pipeLog(child, options.log)

	const crashListeners = new Set<() => void>()
	let stopping = false
	let spawnFailed: Error | undefined
	child.once("error", (err) => {
		spawnFailed = err instanceof Error ? err : new Error(String(err))
	})
	child.on("exit", () => {
		if (!stopping) {
			for (const listener of crashListeners) listener()
		}
	})

	try {
		await waitForHealth(port, child, () => spawnFailed)
	} catch (err) {
		stopping = true
		child.kill()
		throw err
	}

	return {
		port,
		url: `http://127.0.0.1:${port}/`,
		shutdownToken,
		async stop() {
			if (stopping) return
			stopping = true
			await gracefulStop(child, port, shutdownToken)
		},
		onCrash(listener) {
			crashListeners.add(listener)
			return () => {
				crashListeners.delete(listener)
			}
		},
	}
}

function pipeLog(child: ChildProcess, log: (chunk: string) => void): void {
	child.stdout?.on("data", (chunk: Buffer | string) => {
		log(String(chunk))
	})
	child.stderr?.on("data", (chunk: Buffer | string) => {
		log(String(chunk))
	})
}

async function waitForHealth(
	port: number,
	child: ChildProcess,
	spawnError: () => Error | undefined,
): Promise<void> {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS
	while (Date.now() < deadline) {
		const failed = spawnError()
		if (failed !== undefined) throw failed
		if (child.exitCode !== null) {
			throw new Error(
				`sidecar exited before becoming ready (code ${String(child.exitCode)})`,
			)
		}
		try {
			const res = await fetch(`http://127.0.0.1:${port}/health`)
			if (res.ok) {
				const body: unknown = await res.json()
				if (isRecord(body) && body.ok === true) return
			}
		} catch {
			// not listening yet
		}
		await delay(HEALTH_POLL_MS)
	}
	throw new Error(`sidecar did not become ready on port ${port}`)
}

async function gracefulStop(
	child: ChildProcess,
	port: number,
	token: string,
): Promise<void> {
	try {
		await fetch(`http://127.0.0.1:${port}/api/internal/shutdown`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-shutdown-token": token,
			},
			body: JSON.stringify({ token }),
		})
	} catch {
		// already gone
	}
	const exited = await waitForExit(child, SHUTDOWN_TIMEOUT_MS)
	if (!exited) child.kill()
	await waitForExit(child, 2_000)
}

export async function patchSidecarSharedFolder(
	sidecar: SidecarHandle,
	path: string | null,
): Promise<void> {
	const res = await fetch(`${sidecar.url}api/internal/shared-folder`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-shutdown-token": sidecar.shutdownToken,
		},
		body: JSON.stringify({ token: sidecar.shutdownToken, path }),
	})
	if (!res.ok) {
		throw new Error(
			`sidecar shared-folder update failed (${String(res.status)})`,
		)
	}
}

export type SidecarAuthState = {
	readonly configured: boolean
	readonly weakPassword: boolean
}

/**
 * Whether the sidecar has an admin password configured and whether it
 * fails the cheap strength check. The shell calls this before enabling
 * local-network sharing: an unclaimed instance must never become
 * reachable from other devices, and a weak password gets an explicit
 * confirmation first.
 */
export async function readSidecarAuthConfigured(
	sidecar: SidecarHandle,
): Promise<SidecarAuthState> {
	const res = await fetch(`${sidecar.url}api/internal/auth-configured`, {
		headers: { "x-shutdown-token": sidecar.shutdownToken },
	})
	if (!res.ok) {
		throw new Error(
			`sidecar auth-configured check failed (${String(res.status)})`,
		)
	}
	const body: unknown = await res.json()
	if (!isRecord(body)) {
		throw new Error("sidecar auth-configured check failed (bad payload)")
	}
	return {
		configured: body.configured === true,
		weakPassword: body.weakPassword === true,
	}
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (child.exitCode !== null) return Promise.resolve(true)
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.off("exit", onExit)
			resolve(false)
		}, timeoutMs)
		function onExit() {
			clearTimeout(timer)
			resolve(true)
		}
		child.once("exit", onExit)
	})
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
