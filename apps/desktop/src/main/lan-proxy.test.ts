/**
 * @vitest-environment node
 */

import { mkdtempSync, rmSync } from "node:fs"
import { createServer, request as httpRequest, type Server } from "node:http"
import { request as httpsRequest } from "node:https"
import type { AddressInfo } from "node:net"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { type LanProxyHandle, probePort, startLanProxy } from "./lan-proxy.ts"
import { ensureLanCert } from "./tls-cert.ts"

const handles: LanProxyHandle[] = []
const upstreams: Server[] = []
const scratch: string[] = []
let cert: { cert: string; key: string } | undefined

afterEach(async () => {
	for (const handle of handles.splice(0)) await handle.close()
	for (const server of upstreams.splice(0)) {
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

async function listenUpstream(
	handler: Parameters<typeof createServer>[1],
	host = "127.0.0.1",
): Promise<number> {
	const server = createServer(handler)
	upstreams.push(server)
	await new Promise<void>((resolve) => server.listen(0, host, resolve))
	return (server.address() as AddressInfo).port
}

async function freePort(): Promise<number> {
	const server = createNetServer()
	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve()),
	)
	const port = (server.address() as AddressInfo).port
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

function certMaterial(): { cert: string; key: string } {
	if (cert !== undefined) return cert
	const dir = mkdtempSync(join(tmpdir(), "hd-lan-proxy-"))
	scratch.push(dir)
	const material = ensureLanCert({ dir, addresses: ["127.0.0.1"] })
	cert = { cert: material.leafPem, key: material.leafKeyPem }
	return cert
}

type ReqOptions = {
	readonly method?: string
	readonly headers?: Record<string, string>
	readonly body?: string
}

type RawResult = {
	status: number
	body: string
	headers: Record<string, string | string[] | undefined>
}

function httpsRaw(
	port: number,
	path: string,
	options: ReqOptions = {},
): Promise<RawResult> {
	return new Promise((resolve, reject) => {
		const r = httpsRequest(
			{
				host: "127.0.0.1",
				port,
				path,
				method: options.method ?? "GET",
				headers: options.headers,
				rejectUnauthorized: false,
			},
			(res) => {
				let body = ""
				res.on("data", (c) => (body += c.toString("utf8")))
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
				)
			},
		)
		r.on("error", reject)
		if (options.body !== undefined) r.write(options.body)
		r.end()
	})
}

function httpRaw(
	port: number,
	path: string,
	options: ReqOptions = {},
): Promise<RawResult> {
	return new Promise((resolve, reject) => {
		const r = httpRequest(
			{
				host: "127.0.0.1",
				port,
				path,
				method: options.method ?? "GET",
				headers: options.headers,
			},
			(res) => {
				let body = ""
				res.on("data", (c) => (body += c.toString("utf8")))
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
				)
			},
		)
		r.on("error", reject)
		if (options.body !== undefined) r.write(options.body)
		r.end()
	})
}

async function startProxy(
	lanHttps: boolean,
	sidecarPort: number,
): Promise<{ http: number; https: number; handle: LanProxyHandle }> {
	const handle = await startLanProxy({
		sidecarPort,
		lanPort: 0,
		httpsPort: 0,
		lanHttps,
		...certMaterial(),
	})
	handles.push(handle)
	return {
		http: (handle.server.address() as AddressInfo).port,
		https: (handle.httpsServer.address() as AddressInfo).port,
		handle,
	}
}

async function withUpstream(
	handler: Parameters<typeof createServer>[1],
	fn: (sidecarPort: number) => Promise<void>,
): Promise<void> {
	const port = await listenUpstream(handler)
	await fn(port)
}

describe("startLanProxy", () => {
	it("serves http and 301-redirects https when lanHttps is off", async () => {
		await withUpstream(
			(req, res) =>
				res.end(JSON.stringify({ proto: req.headers["x-forwarded-proto"] })),
			async (up) => {
				const served = await startProxy(false, up)
				const httpRes = await httpRaw(served.http, "/")
				expect(httpRes.status).toBe(200)
				expect(JSON.parse(httpRes.body).proto).toBe("http")

				const redirect = await httpsRaw(served.https, "/")
				expect(redirect.status).toBe(301)
				expect(redirect.headers.location).toContain(
					`http://127.0.0.1:${served.http}`,
				)
			},
		)
	})

	it("serves https and 301-redirects http when lanHttps is on", async () => {
		await withUpstream(
			(req, res) =>
				res.end(JSON.stringify({ proto: req.headers["x-forwarded-proto"] })),
			async (up) => {
				const served = await startProxy(true, up)
				const httpsRes = await httpsRaw(served.https, "/")
				expect(httpsRes.status).toBe(200)
				expect(JSON.parse(httpsRes.body).proto).toBe("https")

				const redirect = await httpRaw(served.http, "/")
				expect(redirect.status).toBe(301)
				expect(redirect.headers.location).toContain(
					`https://127.0.0.1:${served.https}`,
				)
			},
		)
	})

	it("streams SSE without buffering on the serving port", async () => {
		await withUpstream(
			(_req, res) => {
				res.writeHead(200, { "content-type": "text/event-stream" })
				res.write("data: one\n\n")
				setTimeout(() => res.write("data: two\n\n"), 20)
				setTimeout(() => res.end(), 60)
			},
			async (up) => {
				const served = await startProxy(false, up)
				const res = await httpRaw(served.http, "/api/events")
				expect(res.status).toBe(200)
				expect(res.body).toContain("data: one")
				expect(res.body).toContain("data: two")
			},
		)
	})

	it("forwards a POST body on the serving port", async () => {
		await withUpstream(
			(req, res) => {
				let body = ""
				req.on("data", (c) => (body += c.toString("utf8")))
				req.on("end", () => res.end(body))
			},
			async (up) => {
				const served = await startProxy(false, up)
				const res = await httpRaw(served.http, "/api/upload", {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "hello=world&x=1",
				})
				expect(res.status).toBe(200)
				expect(res.body).toBe("hello=world&x=1")
			},
		)
	})

	it("passes a Range request through on the serving port", async () => {
		await withUpstream(
			(req, res) => {
				res.writeHead(206, {
					"content-type": "text/plain",
					"content-range": "bytes 0-2/9",
				})
				res.end(req.headers.range === "bytes=0-2" ? "abc" : "no-range")
			},
			async (up) => {
				const served = await startProxy(false, up)
				const res = await httpRaw(served.http, "/media.bin", {
					headers: { range: "bytes=0-2" },
				})
				expect(res.status).toBe(206)
				expect(res.body).toBe("abc")
			},
		)
	})

	it("blocks /api/internal/* with 403", async () => {
		let called = false
		await withUpstream(
			(_req, res) => {
				called = true
				res.end("wrong")
			},
			async (up) => {
				const served = await startProxy(false, up)
				const res = await httpRaw(served.http, "/api/internal/shutdown", {
					method: "POST",
				})
				expect(res.status).toBe(403)
				expect(called).toBe(false)
			},
		)
	})

	it("returns 502 when the sidecar is down", async () => {
		const sidecarPort = await freePort()
		const first = await startProxy(false, sidecarPort)
		await first.handle.close()
		const handle = await startLanProxy({
			sidecarPort,
			lanPort: first.http,
			httpsPort: first.https,
			lanHttps: false,
			...certMaterial(),
		})
		handles.push(handle)
		const res = await httpRaw(first.http, "/")
		expect(res.status).toBe(502)
	})

	it("forwards a non-2xx upstream status (SPA-unavailable 503) verbatim", async () => {
		await withUpstream(
			(_req, res) => {
				res.writeHead(503, {
					"content-type": "text/html; charset=utf-8",
					"x-app-status": "spa-unavailable",
				})
				res.end("<h1>Service Unavailable</h1>")
			},
			async (up) => {
				const served = await startProxy(false, up)
				const res = await httpRaw(served.http, "/")
				expect(res.status).toBe(503)
				expect(res.body).toContain("Service Unavailable")
				expect(res.headers["x-app-status"]).toBe("spa-unavailable")
			},
		)
	})

	it("overwrites a forged X-Forwarded-For with the real peer address", async () => {
		await withUpstream(
			(req, res) =>
				res.end(JSON.stringify({ peer: req.headers["x-forwarded-for"] })),
			async (up) => {
				const served = await startProxy(false, up)
				const res = await httpRaw(served.http, "/", {
					headers: { "x-forwarded-for": "1.2.3.4" },
				})
				expect(JSON.parse(res.body).peer).toContain("127.0.0.1")
			},
		)
	})

	it("releases both ports on close and can bind them again", async () => {
		const served = await startProxy(false, 1)
		await httpRaw(served.http, "/")
		await served.handle.close()
		const second = await startLanProxy({
			sidecarPort: 1,
			lanPort: served.http,
			httpsPort: served.https,
			lanHttps: false,
			...certMaterial(),
		})
		handles.push(second)
		expect(second.port).toBe(served.http)
		expect(second.httpsPort).toBe(served.https)
	})

	it("reuses the SAME ports across repeated close/open (apply 3002 -> 3003 -> 3002)", async () => {
		const httpPort = await freePort()
		const httpsPort = await freePort()
		for (let i = 0; i < 3; i++) {
			const handle = await startLanProxy({
				sidecarPort: 1,
				lanPort: httpPort,
				httpsPort,
				lanHttps: false,
				...certMaterial(),
			})
			handles.push(handle)
			expect(handle.port).toBe(httpPort)
			expect(handle.httpsPort).toBe(httpsPort)
			await handle.close()
			handles.pop()
		}
	})

	it("probePort reports a just-released port reusable and a held port unusable", async () => {
		const p = await freePort()
		expect(await probePort("0.0.0.0", p)).toBe(true)
		const held = await listenUpstream((_req, res) => res.end(), "0.0.0.0")
		expect(await probePort("0.0.0.0", held)).toBe(false)
	})

	it("falls back to a new port when the preferred LAN port is held (EADDRINUSE)", async () => {
		const held = await listenUpstream((_req, res) => res.end(), "0.0.0.0")
		let httpsPort = 20000
		while (!(await probePort("0.0.0.0", httpsPort))) httpsPort += 1
		const handle = await startLanProxy({
			sidecarPort: 1,
			lanPort: held,
			httpsPort,
			lanHttps: false,
			...certMaterial(),
		})
		handles.push(handle)
		expect(handle.port).not.toBe(held)
		expect(handle.port).toBeGreaterThan(0)
		expect(handle.httpsPort).toBe(httpsPort)
	})
})
