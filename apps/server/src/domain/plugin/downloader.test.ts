import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveProxyConfig } from "@hoardodile/shared/net-proxy"
import { afterEach, describe, expect, test } from "vitest"
import { createPluginDownloader, vetDownloadUrl } from "./downloader.ts"

let server: Server | undefined
let root: string | undefined

afterEach(async () => {
	await new Promise<void>((resolve) => {
		if (server === undefined) return resolve()
		server.close(() => resolve())
		server = undefined
	})
	if (root !== undefined) await rm(root, { recursive: true, force: true })
	root = undefined
})

type ListenHandler = (req: IncomingMessage, res: ServerResponse) => void

function listen(handler: ListenHandler): Promise<string> {
	server = createServer(handler)
	return new Promise((resolve) => {
		server!.listen(0, "127.0.0.1", () => {
			const addr = server!.address()
			if (addr === null || typeof addr === "string") throw new Error("no addr")
			resolve(`http://127.0.0.1:${addr.port}`)
		})
	})
}

function tempDir(): string {
	root = mkdtempSync(join(tmpdir(), "hoardodile-dl-"))
	return root
}

function downloader(
	overrides: Partial<Parameters<typeof createPluginDownloader>[0]> = {},
) {
	return createPluginDownloader({
		maxBytes: 64,
		timeoutMs: 2_000,
		allowPrivate: true,
		...overrides,
	})
}

describe("vetDownloadUrl", () => {
	test("accepts http(s) and returns the canonical form", () => {
		expect(vetDownloadUrl("https://example.com/a.mjs?x=1#f")).toBe(
			"https://example.com/a.mjs?x=1#f",
		)
	})

	test("rejects non-http schemes, empty hosts and userinfo", () => {
		for (const url of [
			"file:///etc/passwd",
			"ftp://example.com/x",
			"data:text/plain,hi",
			"https://user:pass@example.com/x",
			"",
			"not a url",
		]) {
			expect(() => vetDownloadUrl(url)).toThrow()
		}
	})
})

describe("createPluginDownloader", () => {
	test("streams a body to the target and reports size + sha256", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200, { "content-length": "5" })
			res.end("hello")
		})
		const dir = tempDir()
		const target = join(dir, "out.bin")
		const result = await downloader().fetchToFile(`${base}/file.bin`, target)
		expect(result.sizeBytes).toBe(5)
		expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(readFileSync(target, "utf-8")).toBe("hello")
	})

	test("aborts mid-stream when the byte cap is crossed", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200)
			res.write("x".repeat(40))
			setTimeout(() => res.end("y".repeat(40)), 20)
		})
		const dir = tempDir()
		const target = join(dir, "cap.bin")
		await expect(
			downloader({ maxBytes: 64 }).fetchToFile(`${base}/x`, target),
		).rejects.toMatchObject({ name: "POLICY" })
		// The staging file is the caller's to discard (partial bytes).
	})

	test("follows at most 5 redirects and re-vets each hop", async () => {
		const base = await listen((req, res) => {
			const n = Number((req.url ?? "").replace("/", "")) || 0
			if (n < 5) {
				res.writeHead(302, { location: `/${n + 1}` })
				res.end()
			} else {
				res.writeHead(200)
				res.end("done")
			}
		})
		const dir = tempDir()
		const target = join(dir, "redir.bin")
		const result = await downloader().fetchToFile(`${base}/0`, target)
		expect(result.sizeBytes).toBe(4)
	})

	test("rejects a redirect over the cap", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(302, { location: "/next" })
			res.end()
		})
		await expect(
			downloader().fetchToFile(`${base}/x`, join(tempDir(), "r.bin")),
		).rejects.toThrow(/more than 5 redirects/)
	})

	test("surfaces a non-2xx status as an ordinary error", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(404)
			res.end()
		})
		await expect(
			downloader().fetchToFile(`${base}/missing`, join(tempDir(), "m.bin")),
		).rejects.toThrow(/HTTP 404/)
	})

	test("HEAD probes report content-length and never throw", async () => {
		const base = await listen((req, res) => {
			if (req.method === "HEAD" && req.url === "/x") {
				res.writeHead(200, { "content-length": "1234" })
				res.end()
				return
			}
			res.writeHead(404)
			res.end()
		})
		const dl = downloader()
		expect(await dl.probeSize(`${base}/x`)).toBe(1234)
		expect(await dl.probeSize(`${base}/err`)).toBeUndefined()
	})

	test("private addresses are rejected by default (resolve-time policy)", async () => {
		const dl = createPluginDownloader({
			maxBytes: 64,
			timeoutMs: 2_000,
			allowPrivate: false,
		})
		// 127.0.0.1 is loopback: the literal-IP pre-check refuses it
		// before any socket exists (IP literals bypass node's resolver,
		// so the custom lookup alone can never see them).
		await expect(
			dl.fetchToFile("http://127.0.0.1:1/x", join(tempDir(), "p.bin")),
		).rejects.toMatchObject({ name: "POLICY" })
		await expect(dl.probeSize("http://127.0.0.1:1/x")).rejects.toMatchObject({
			name: "POLICY",
		})
		expect(() => dl.vetUrl("http://127.0.0.1:1/x")).toThrow()
	})

	test("per-call maxBytes overrides the constructor cap", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200)
			res.end("x".repeat(40))
		})
		const dl = downloader({ maxBytes: 4 * 1024 * 1024 })
		const target = join(tempDir(), "cap.bin")
		// Constructor allows 4 MiB; the per-call cap of 16 bytes still trips.
		await expect(
			dl.fetchToFile(`${base}/big`, target, { maxBytes: 16 }),
		).rejects.toMatchObject({ name: "POLICY" })
	})

	test("per-call headers are merged over the default request headers", async () => {
		let seenUserAgent: string | undefined
		const base = await listen((req, res) => {
			seenUserAgent = req.headers["user-agent"]
			res.writeHead(200)
			res.end("ok")
		})
		const dl = downloader()
		await dl.fetchToFile(`${base}/x`, join(tempDir(), "h.bin"), {
			headers: { "User-Agent": "hoardodile-test" },
		})
		expect(seenUserAgent).toBe("hoardodile-test")
	})

	test("routes http targets through the configured proxy (absolute-form)", async () => {
		let seenUrl: string | undefined
		const proxy = createServer((req, res) => {
			seenUrl = req.url
			res.writeHead(200, { "content-length": "4" })
			res.end("okay")
		})
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
		const addr = proxy.address()
		if (addr === null || typeof addr === "string") throw new Error("no addr")
		try {
			const dl = downloader({
				proxy: () =>
					resolveProxyConfig(
						{ HOARDODILE_PROXY: `http://127.0.0.1:${addr.port}` },
						"linux",
					),
			})
			const target = join(tempDir(), "via-proxy.bin")
			await dl.fetchToFile("http://downloader.test/x.bin", target)
			expect(seenUrl).toBe("http://downloader.test/x.bin")
			expect(readFileSync(target, "utf-8")).toBe("okay")
		} finally {
			await new Promise<void>((resolve) => proxy.close(() => resolve()))
		}
	})

	test("proxies https targets via CONNECT and forwards proxy auth", async () => {
		const connects: Array<{ path?: string; auth?: string }> = []
		const proxy = createServer()
		proxy.on("connect", (req, clientSocket) => {
			connects.push({
				path: req.url,
				auth: String(req.headers["proxy-authorization"] ?? ""),
			})
			// Accept the tunnel, then destroy it on the first TLS byte:
			// the handshake against the fake target can never complete,
			// but we only assert the CONNECT request itself.
			clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
			clientSocket.once("data", () => clientSocket.destroy())
		})
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
		const addr = proxy.address()
		if (addr === null || typeof addr === "string") throw new Error("no addr")
		try {
			const dl = downloader({
				proxy: () =>
					resolveProxyConfig(
						{
							HOARDODILE_PROXY: `http://user:pw@127.0.0.1:${addr.port}`,
						},
						"linux",
					),
			})
			await expect(
				dl.fetchToFile(
					"https://downloader.test/x.bin",
					join(tempDir(), "tunnel.bin"),
				),
			).rejects.toThrow()
			expect(connects[0]?.path).toBe("downloader.test:443")
			expect(connects[0]?.auth).toBe(
				`Basic ${Buffer.from("user:pw").toString("base64")}`,
			)
		} finally {
			await new Promise<void>((resolve) => proxy.close(() => resolve()))
		}
	})

	test("loopback targets stay direct even with a proxy configured", async () => {
		const base = await listen((_req, res) => {
			res.writeHead(200)
			res.end("direct")
		})
		const dl = downloader({
			proxy: () =>
				resolveProxyConfig({ HOARDODILE_PROXY: "http://127.0.0.1:9" }, "linux"),
		})
		const target = join(tempDir(), "direct.bin")
		await dl.fetchToFile(`${base}/x`, target)
		expect(readFileSync(target, "utf-8")).toBe("direct")
	})

	test("bypass entries keep targets on the direct path", async () => {
		const proxy = createServer((_req, res) => {
			res.writeHead(500)
			res.end()
		})
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
		const addr = proxy.address()
		if (addr === null || typeof addr === "string") throw new Error("no addr")
		try {
			const dl = downloader({
				proxy: () =>
					resolveProxyConfig(
						{
							HOARDODILE_PROXY: `http://127.0.0.1:${addr.port}`,
							NO_PROXY: "downloader.test",
						},
						"linux",
					),
			})
			// downloader.test gets no proxy → direct → DNS fails, instead
			// of the proxy happily answering.
			await expect(
				dl.fetchToFile(
					"http://downloader.test/x.bin",
					join(tempDir(), "bypass.bin"),
				),
			).rejects.toThrow()
		} finally {
			await new Promise<void>((resolve) => proxy.close(() => resolve()))
		}
	})

	test("re-reads the proxy per request (a proxy enabled after boot is picked up)", async () => {
		let seenA: string | undefined
		let seenB: string | undefined
		const proxyA = createServer((req, res) => {
			seenA = req.url
			res.writeHead(200, { "content-length": "4" })
			res.end("okay")
		})
		const proxyB = createServer((req, res) => {
			seenB = req.url
			res.writeHead(200, { "content-length": "4" })
			res.end("okay")
		})
		await Promise.all([
			new Promise<void>((resolve) => proxyA.listen(0, "127.0.0.1", resolve)),
			new Promise<void>((resolve) => proxyB.listen(0, "127.0.0.1", resolve)),
		])
		const addrA = proxyA.address()
		const addrB = proxyB.address()
		if (addrA === null || typeof addrA === "string") throw new Error("no addrA")
		if (addrB === null || typeof addrB === "string") throw new Error("no addrB")
		let target = addrA.port
		try {
			const dl = downloader({
				proxy: () =>
					resolveProxyConfig(
						{ HOARDODILE_PROXY: `http://127.0.0.1:${target}` },
						"linux",
					),
			})
			await dl.fetchToFile(
				"http://downloader.test/a.bin",
				join(tempDir(), "a.bin"),
			)
			target = addrB.port
			await dl.fetchToFile(
				"http://downloader.test/b.bin",
				join(tempDir(), "b.bin"),
			)
			expect(seenA).toBe("http://downloader.test/a.bin")
			expect(seenB).toBe("http://downloader.test/b.bin")
		} finally {
			await new Promise<void>((resolve) => proxyA.close(() => resolve()))
			await new Promise<void>((resolve) => proxyB.close(() => resolve()))
		}
	})

	test("a proxy removed after boot routes the next request directly", async () => {
		let proxyHits = 0
		let proxyUrl: string | undefined
		const proxy = createServer((req, res) => {
			proxyHits += 1
			proxyUrl = req.url
			res.writeHead(200, { "content-length": "4" })
			res.end("okay")
		})
		let directHits = 0
		const direct = createServer((_req, res) => {
			directHits += 1
			res.writeHead(200, { "content-length": "6" })
			res.end("direct")
		})
		await Promise.all([
			new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve)),
			new Promise<void>((resolve) => direct.listen(0, "127.0.0.1", resolve)),
		])
		const addrProxy = proxy.address()
		const addrDirect = direct.address()
		if (addrProxy === null || typeof addrProxy === "string")
			throw new Error("no addrProxy")
		if (addrDirect === null || typeof addrDirect === "string")
			throw new Error("no addrDirect")
		let on = true
		const dl = downloader({
			proxy: () =>
				resolveProxyConfig(
					on
						? { HOARDODILE_PROXY: `http://127.0.0.1:${addrProxy.port}` }
						: { HOARDODILE_PROXY: "off" },
					"linux",
				),
		})
		try {
			await dl.fetchToFile(
				"http://downloader.test/a.bin",
				join(tempDir(), "a.bin"),
			)
			on = false
			await dl.fetchToFile(
				`http://127.0.0.1:${addrDirect.port}/x`,
				join(tempDir(), "d.bin"),
			)
			// Proxy saw only the first request; the disabled state went direct.
			expect(proxyHits).toBe(1)
			expect(proxyUrl).toBe("http://downloader.test/a.bin")
			expect(directHits).toBe(1)
		} finally {
			await new Promise<void>((resolve) => proxy.close(() => resolve()))
			await new Promise<void>((resolve) => direct.close(() => resolve()))
		}
	})
})
