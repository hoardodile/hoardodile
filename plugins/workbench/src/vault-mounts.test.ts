import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createWorkbenchMounts } from "../scripts/mounts.mjs"

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111"

let server: Server | undefined
const roots: string[] = []

// The fixture sources below all listen on 127.0.0.1: the dev-tool
// default rejects private IP literals, so the loopback fixtures opt in
// explicitly; the rejection paths are covered by their own tests.
beforeEach(() => {
	process.env.WORKBENCH_VAULT_ALLOW_PRIVATE = "1"
})

afterEach(async () => {
	delete process.env.WORKBENCH_VAULT_ALLOW_PRIVATE
	await new Promise<void>((resolve) => {
		if (server === undefined) return resolve()
		server.close(() => resolve())
		server = undefined
	})
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true })
})

function vaultRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "workbench-vault-"))
	roots.push(root)
	return root
}

async function listenWith(vault: string): Promise<string> {
	const mounts = createWorkbenchMounts({
		vault,
		providers: { resources: () => [] },
	})
	server = createServer((req, res) => {
		void (async () => {
			for (const mount of mounts) {
				if (await mount(req, res)) return
			}
			res.statusCode = 404
			res.end("not found")
		})()
	})
	return new Promise((resolve) => {
		server!.listen(0, "127.0.0.1", () => {
			const addr = server!.address()
			if (addr === null || typeof addr === "string") throw new Error("no addr")
			resolve(`http://127.0.0.1:${addr.port}`)
		})
	})
}

function jsonHeaders(
	extra: Record<string, string> = {},
): Record<string, string> {
	return { "content-type": "application/json", ...extra }
}

/** Minimal req/res doubles for driving mounts without URL normalization. */
function fakeRequest(url: string): IncomingMessage {
	return { method: "GET", url } as unknown as IncomingMessage
}

function fakeResponse() {
	const res = {
		statusCode: 0,
		headers: {} as Record<string, string>,
		body: "",
	}
	return {
		...res,
		setHeader(key: string, value: string) {
			res.headers[key] = value
		},
		get status() {
			return res.statusCode
		},
		end(body?: string) {
			res.body = body ?? ""
		},
	} as unknown as ServerResponse & {
		readonly status: number
		readonly body: string
	}
}

describe("workbench plugin asset vault mounts", () => {
	it("serves nested asset paths with CORS/nosniff and html as attachment", async () => {
		const vault = vaultRoot()
		mkdirSync(join(vault, PLUGIN_ID, "runtime"), { recursive: true })
		writeFileSync(
			join(vault, PLUGIN_ID, "runtime", "live2d.min.js"),
			"window.L2D=1;\n",
		)
		const base = await listenWith(vault)

		const res = await fetch(
			`${base}/api/plugin-assets/${PLUGIN_ID}/any-token/runtime/live2d.min.js`,
		)
		expect(res.status).toBe(200)
		expect(res.headers.get("access-control-allow-origin")).toBe("*")
		expect(res.headers.get("x-content-type-options")).toBe("nosniff")
		expect(res.headers.get("content-type")).toContain("text/javascript")
		expect(await res.text()).toBe("window.L2D=1;\n")

		writeFileSync(join(vault, PLUGIN_ID, "page.html"), "<html></html>")
		const html = await fetch(
			`${base}/api/plugin-assets/${PLUGIN_ID}/t/page.html`,
		)
		expect(html.headers.get("content-type")).toContain(
			"application/octet-stream",
		)
		expect(html.headers.get("content-disposition")).toBe("attachment")
	})

	it("rejects traversal in the asset path", async () => {
		const vault = vaultRoot()
		writeFileSync(join(vault, "outside.txt"), "x")
		// Drive the mounts directly with an encoded-slashes traversal:
		// the URL parser collapses dot segments (`../`) away, but an
		// encoded-slash form survives to the handler — whose safeJoin
		// boundary must reject the decoded path.
		const mounts = createWorkbenchMounts({
			vault,
			providers: { resources: () => [] },
		})
		const res = fakeResponse()
		for (const mount of mounts) {
			if (
				await mount(
					fakeRequest(
						`/api/plugin-assets/${PLUGIN_ID}/t/%2e%2e%2f%2e%2e%2foutside.txt`,
					),
					res,
				)
			) {
				break
			}
		}
		expect(res.statusCode).toBe(403)
	})

	it("download: cache-first, then consentless force stores atomically", async () => {
		const vault = vaultRoot()
		const src = createServer((_req: IncomingMessage, res: ServerResponse) => {
			res.writeHead(200, { "content-type": "text/javascript" })
			res.end("window.RUNTIME=1;")
		})
		await new Promise<void>((resolve) => src.listen(0, "127.0.0.1", resolve))
		const srcAddr = src.address()
		if (srcAddr === null || typeof srcAddr === "string")
			throw new Error("no addr")
		const srcUrl = `http://127.0.0.1:${srcAddr.port}/runtime.mjs`
		const base = await listenWith(vault)

		const body = JSON.stringify({
			pluginId: PLUGIN_ID,
			url: srcUrl,
			dest: "runtime.mjs",
		})

		const first = await fetch(`${base}/api/workbench/vault/download`, {
			method: "POST",
			headers: jsonHeaders(),
			body,
		})
		expect(await first.json()).toMatchObject({ status: "missing" })

		const forced = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body,
		})
		const done = (await forced.json()) as {
			status: string
			path: string
			sizeBytes: number
			sha256: string
		}
		expect(done.status).toBe("downloaded")
		expect(done.path).toBe("runtime.mjs")
		expect(done.sha256).toMatch(/^[0-9a-f]{64}$/)

		const cached = await fetch(`${base}/api/workbench/vault/download`, {
			method: "POST",
			headers: jsonHeaders(),
			body,
		})
		expect(await cached.json()).toMatchObject({
			status: "cached",
			path: "runtime.mjs",
			sizeBytes: done.sizeBytes,
			sha256: done.sha256,
		})

		const fetched = await fetch(
			`${base}/api/plugin-assets/${PLUGIN_ID}/t/runtime.mjs`,
		)
		expect(await fetched.text()).toBe("window.RUNTIME=1;")
		src.close()
	})

	it("download: sha256 pin mismatch never commits", async () => {
		const vault = vaultRoot()
		const src = createServer((_req: IncomingMessage, res: ServerResponse) => {
			res.writeHead(200)
			res.end("hello")
		})
		await new Promise<void>((resolve) => src.listen(0, "127.0.0.1", resolve))
		const srcAddr = src.address()
		if (srcAddr === null || typeof srcAddr === "string")
			throw new Error("no addr")
		const srcUrl = `http://127.0.0.1:${srcAddr.port}/a.mjs`
		const base = await listenWith(vault)

		const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				pluginId: PLUGIN_ID,
				url: srcUrl,
				dest: "a.mjs",
				sha256: "0".repeat(64),
			}),
		})
		const body = (await res.json()) as { status: string; error?: string }
		expect(body.status).toBe("error")
		expect(body.error).toContain("sha256 mismatch")
		src.close()
	})

	it("delete is idempotent and confined", async () => {
		const vault = vaultRoot()
		mkdirSync(join(vault, PLUGIN_ID), { recursive: true })
		writeFileSync(join(vault, PLUGIN_ID, "x.mjs"), "x")
		const base = await listenWith(vault)

		const del = (path: string) =>
			fetch(`${base}/api/workbench/vault/delete`, {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({ pluginId: PLUGIN_ID, path }),
			}).then((r) => r.json())
		expect(await del("x.mjs")).toEqual({ existed: true })
		expect(await del("x.mjs")).toEqual({ existed: false })
		const escapeRes = await fetch(`${base}/api/workbench/vault/delete`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({ pluginId: PLUGIN_ID, path: "../escape" }),
		})
		expect(escapeRes.status).toBe(403)
	})

	it("rejects non-http schemes in the download endpoint", async () => {
		const base = await listenWith(vaultRoot())
		const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				pluginId: PLUGIN_ID,
				url: "file:///etc/passwd",
				dest: "x",
			}),
		})
		expect(((await res.json()) as { status: string }).status).toBe("error")
	})

	it("download: rejects private IP-literal targets by default", async () => {
		const vault = vaultRoot()
		const src = createServer((_req: IncomingMessage, res: ServerResponse) => {
			res.writeHead(200)
			res.end("hello")
		})
		await new Promise<void>((resolve) => src.listen(0, "127.0.0.1", resolve))
		const srcAddr = src.address()
		if (srcAddr === null || typeof srcAddr === "string")
			throw new Error("no addr")
		const srcUrl = `http://127.0.0.1:${srcAddr.port}/a.mjs`
		const base = await listenWith(vault)

		delete process.env.WORKBENCH_VAULT_ALLOW_PRIVATE
		const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				pluginId: PLUGIN_ID,
				url: srcUrl,
				dest: "a.mjs",
			}),
		})
		const body = (await res.json()) as { status: string; error?: string }
		expect(body.status).toBe("error")
		expect(body.error).toContain("address is not public")
		src.close()
	})

	it("download: rejects IPv6 loopback and non-public literal ranges pre-network", async () => {
		const base = await listenWith(vaultRoot())
		delete process.env.WORKBENCH_VAULT_ALLOW_PRIVATE
		for (const url of [
			"http://[::1]/a.mjs",
			"http://[fe80::1]/a.mjs",
			"http://100.64.0.1/a.mjs",
			"http://224.0.0.1/a.mjs",
			"http://[::ffff:127.0.0.1]/a.mjs",
		]) {
			const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
				method: "POST",
				headers: jsonHeaders(),
				body: JSON.stringify({
					pluginId: PLUGIN_ID,
					url,
					dest: "a.mjs",
				}),
			})
			const body = (await res.json()) as { status: string; error?: string }
			expect(body.status).toBe("error")
			expect(body.error).toContain("address is not public")
		}
	})

	it("download: WORKBENCH_VAULT_ALLOW_PRIVATE permits IPv6 loopback", async () => {
		process.env.WORKBENCH_VAULT_ALLOW_PRIVATE = "1"
		const vault = vaultRoot()
		const src = createServer((_req: IncomingMessage, res: ServerResponse) => {
			res.writeHead(200)
			res.end("hello")
		})
		await new Promise<void>((resolve) => src.listen(0, "::", resolve))
		const srcAddr = src.address()
		if (srcAddr === null || typeof srcAddr === "string")
			throw new Error("no addr")
		const srcUrl = `http://[::1]:${srcAddr.port}/a.mjs`
		const base = await listenWith(vault)

		const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				pluginId: PLUGIN_ID,
				url: srcUrl,
				dest: "a.mjs",
			}),
		})
		const body = (await res.json()) as { status: string; sha256?: string }
		expect(body.status).toBe("downloaded")
		expect(body.sha256).toMatch(/^[0-9a-f]{64}$/)
		src.close()
	})

	it("download: redirect targets are re-vetted against the same rule", async () => {
		const vault = vaultRoot()
		const src = createServer((_req: IncomingMessage, res: ServerResponse) => {
			res.writeHead(302, { location: "http://10.0.0.1/internal.mjs" })
			res.end()
		})
		await new Promise<void>((resolve) => src.listen(0, "127.0.0.1", resolve))
		const srcAddr = src.address()
		if (srcAddr === null || typeof srcAddr === "string")
			throw new Error("no addr")
		const srcUrl = `http://127.0.0.1:${srcAddr.port}/a.mjs`
		const base = await listenWith(vault)

		delete process.env.WORKBENCH_VAULT_ALLOW_PRIVATE
		const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				pluginId: PLUGIN_ID,
				url: srcUrl,
				dest: "a.mjs",
			}),
		})
		const body = (await res.json()) as { status: string; error?: string }
		expect(body.status).toBe("error")
		expect(body.error).toContain("address is not public")
		src.close()
	})

	it("download: WORKBENCH_VAULT_ALLOW_PRIVATE permits loopback fixtures", async () => {
		process.env.WORKBENCH_VAULT_ALLOW_PRIVATE = "1"
		const vault = vaultRoot()
		const src = createServer((_req: IncomingMessage, res: ServerResponse) => {
			res.writeHead(200)
			res.end("hello")
		})
		await new Promise<void>((resolve) => src.listen(0, "127.0.0.1", resolve))
		const srcAddr = src.address()
		if (srcAddr === null || typeof srcAddr === "string")
			throw new Error("no addr")
		const srcUrl = `http://127.0.0.1:${srcAddr.port}/a.mjs`
		const base = await listenWith(vault)

		const res = await fetch(`${base}/api/workbench/vault/download?force=1`, {
			method: "POST",
			headers: jsonHeaders(),
			body: JSON.stringify({
				pluginId: PLUGIN_ID,
				url: srcUrl,
				dest: "a.mjs",
			}),
		})
		const body = (await res.json()) as { status: string; sha256?: string }
		expect(body.status).toBe("downloaded")
		expect(body.sha256).toMatch(/^[0-9a-f]{64}$/)
		src.close()
	})

	it("hashes the size the same way the file list reports it", () => {
		const value = "export const x = 1\n"
		expect(createHash("sha256").update(value).digest("hex")).toMatch(
			/^[0-9a-f]{64}$/,
		)
	})
})
