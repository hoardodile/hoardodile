/**
 * Embedded LAN forwarder for the desktop's local-network share.
 *
 * Two always-on listeners on `0.0.0.0` so a URL never breaks when the
 * operator toggles the scheme:
 *
 *  - `lanPort`  — plain HTTP.
 *  - `httpsPort`— TLS (self-signed cert), both ports always present.
 *
 * `lanHttps` picks which scheme *serves* the app; the other port issues a
 * `301` to the serving scheme, so the previously-used URL keeps working
 * (auto-redirect) instead of failing after a toggle.
 *
 * Both listeners app-layer proxy to the loopback sidecar
 * (`http://127.0.0.1:<sidecarPort>`) as a streaming byte pipe, so SSE at
 * `/api/events`, media `Range` requests and large uploads/downloads pass
 * through untouched. `/api/internal/*` is refused with 403; `X-Forwarded-*`
 * headers are set (with `X-Forwarded-For` overwritten from the TCP peer).
 *
 * The sidecar keeps serving plain HTTP on loopback; no Fastify changes.
 */

import {
	createServer,
	type IncomingMessage,
	type OutgoingHttpHeaders,
	request,
	type Server,
	type ServerResponse,
} from "node:http"
import { createServer as createHttpsServer } from "node:https"
import type { AddressInfo, Socket } from "node:net"

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
])

export type LanProxyOptions = {
	/** Loopback port of the sidecar to forward to (already listening). */
	readonly sidecarPort: number
	/** HTTP port (0.0.0.0) — serves when `lanHttps` is off, else redirects to `httpsPort`. */
	readonly lanPort: number
	/** HTTPS port (0.0.0.0) — serves when `lanHttps` is on, else redirects to `lanPort`. */
	readonly httpsPort: number
	/** Whether the serving scheme is HTTPS. */
	readonly lanHttps: boolean
	/** PEM leaf certificate (always generated so both ports can stay up). */
	readonly cert: string
	/** PEM leaf private key. */
	readonly key: string
}

export type LanProxyHandle = {
	/** The actual bound HTTP port. */
	readonly port: number
	/** The actual bound HTTPS port. */
	readonly httpsPort: number
	/** The underlying HTTP server, exposed for tests. */
	readonly server: Server
	/** The underlying HTTPS server, exposed for tests. */
	readonly httpsServer: Server
	close: () => Promise<void>
}

type LanProxyState = {
	sidecarPort: number
	lanHttps: boolean
	httpPort: number
	httpsPort: number
}

export function startLanProxy(
	options: LanProxyOptions,
): Promise<LanProxyHandle> {
	// Ports are written with the actually-bound values after listen so the
	// redirect target always carries the real port even when 0 was requested.
	const state: LanProxyState = {
		sidecarPort: options.sidecarPort,
		lanHttps: options.lanHttps,
		httpPort: options.lanPort,
		httpsPort: options.httpsPort,
	}
	const httpServer = createServer((req, res) => handle(req, res, "http", state))
	const httpsServer = createHttpsServer(
		{ cert: options.cert, key: options.key },
		(req, res) => handle(req, res, "https", state),
	)
	const sockets = new Set<Socket>()
	for (const server of [httpServer, httpsServer]) {
		server.on("connection", (socket) => {
			sockets.add(socket)
			socket.on("close", () => sockets.delete(socket))
		})
	}
	return Promise.all([
		listen(httpServer, options.lanPort),
		listen(httpsServer, options.httpsPort),
	]).then(() => {
		state.httpPort = (httpServer.address() as AddressInfo).port
		state.httpsPort = (httpsServer.address() as AddressInfo).port
		return {
			port: state.httpPort,
			httpsPort: state.httpsPort,
			server: httpServer,
			httpsServer,
			close: () => closeServer([httpServer, httpsServer], sockets),
		}
	})
}

function handle(
	req: IncomingMessage,
	res: ServerResponse,
	scheme: "http" | "https",
	state: LanProxyState,
): void {
	const url = safeUrl(req.url)
	if (url?.pathname.startsWith("/api/internal/")) {
		res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
		res.end("Forbidden")
		return
	}

	const serving = scheme === "http" ? !state.lanHttps : state.lanHttps
	if (!serving) {
		redirect(req, res, state)
		return
	}

	const forwardHeaders = { ...req.headers }
	for (const name of HOP_BY_HOP) delete forwardHeaders[name.toLowerCase()]

	const upstream = request(
		{
			host: "127.0.0.1",
			port: state.sidecarPort,
			method: req.method,
			path: req.url ?? "/",
			headers: {
				...forwardHeaders,
				host: `127.0.0.1:${state.sidecarPort}`,
				"x-forwarded-proto": scheme,
				"x-forwarded-host": req.headers.host ?? "",
				"x-forwarded-for": req.socket.remoteAddress ?? "",
			},
		},
		(upstreamResponse) => {
			const headers: OutgoingHttpHeaders = { ...upstreamResponse.headers }
			for (const name of HOP_BY_HOP) delete headers[name.toLowerCase()]
			res.writeHead(upstreamResponse.statusCode ?? 502, headers)
			upstreamResponse.pipe(res)
		},
	)
	upstream.on("error", () => {
		if (!res.headersSent) {
			res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
		}
		res.end()
	})
	req.on("aborted", () => upstream.destroy())
	req.pipe(upstream)
}

function redirect(
	req: IncomingMessage,
	res: ServerResponse,
	state: LanProxyState,
): void {
	const targetScheme = state.lanHttps ? "https" : "http"
	const targetPort = state.lanHttps ? state.httpsPort : state.httpPort
	const hostname =
		hostnameOf(req.headers.host) ?? req.socket.localAddress ?? "localhost"
	const target = `${targetScheme}://${hostname}:${targetPort}${req.url ?? "/"}`
	res.writeHead(301, {
		location: target,
		"content-type": "text/plain; charset=utf-8",
	})
	res.end(`Redirecting to ${target}`)
}

function hostnameOf(host: string | undefined): string | undefined {
	if (host === undefined || host.length === 0) return undefined
	try {
		return new URL(`http://${host}`).hostname
	} catch {
		return host.split(":")[0]
	}
}

function safeUrl(raw: string | undefined): URL | undefined {
	if (raw === undefined || raw.length === 0) return undefined
	try {
		return new URL(raw, "http://localhost")
	} catch {
		return undefined
	}
}

function listen(server: Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (err: Error): void => {
			server.off("listening", onListening)
			reject(err)
		}
		const onListening = (): void => {
			server.off("error", onError)
			resolve()
		}
		server.once("error", onError)
		server.once("listening", onListening)
		server.listen({ host: "0.0.0.0", port })
	})
}

function closeServer(servers: Server[], sockets: Set<Socket>): Promise<void> {
	return new Promise((resolve, reject) => {
		for (const socket of sockets) socket.destroy()
		let pending = 0
		let failed: Error | undefined
		const done = (err?: Error): void => {
			if (err !== undefined && failed === undefined) failed = err
			pending -= 1
			if (pending === 0) {
				if (failed !== undefined) reject(failed)
				else resolve()
			}
		}
		for (const server of servers) {
			if (!server.listening) continue
			pending += 1
			server.close((err) => done(err === undefined ? undefined : err))
		}
		if (pending === 0) resolve()
	})
}
