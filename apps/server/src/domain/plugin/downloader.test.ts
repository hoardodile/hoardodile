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
})
