import { mkdtemp, rm } from "node:fs/promises"
import { createServer as createHttpServer, type Server } from "node:http"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { developmentBackend } from "../../../../scripts/lib/dev-backend.mjs"

vi.mock("node:net", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:net")>()
	return { ...actual, createServer: vi.fn(actual.createServer) }
})

const directories: string[] = []
const metadata = new Set<string>()
const servers: Server[] = []
afterEach(async () => {
	for (const server of servers.splice(0))
		await new Promise<void>((resolve) => server.close(() => resolve()))
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true })
	for (const file of metadata) await rm(file, { force: true })
	metadata.clear()
	vi.mocked(createServer).mockClear()
})

async function environment(port: number) {
	const root = await mkdtemp(join(tmpdir(), "dev-port-allocation-"))
	directories.push(root)
	return { STORAGE_ROOT: root, HOST: "127.0.0.1", PORT: String(port) }
}

async function resolveBackend(env: NodeJS.ProcessEnv) {
	const result = await developmentBackend(env)
	metadata.add(result.addressFile)
	metadata.add(result.addressFile.replace(/\.address\.json$/, ".token"))
	metadata.add(
		result.addressFile.replace(/\.address\.json$/, ".port-lock.sqlite"),
	)
	return result
}

it("falls back after EACCES on the actual bind host and publishes one shared port", async () => {
	const actual = await vi.importActual<typeof import("node:net")>("node:net")
	const attempted: unknown[] = []
	vi.mocked(createServer).mockImplementationOnce(() => {
		const server = actual.createServer()
		server.listen = (...args: unknown[]) => {
			attempted.push(args[0])
			queueMicrotask(() =>
				server.emit(
					"error",
					Object.assign(new Error("reserved"), { code: "EACCES" }),
				),
			)
			return server
		}
		return server
	})
	const env = await environment(3000)
	const first = await resolveBackend(env)
	expect(first.port).not.toBe(3000)
	expect(attempted).toEqual([{ host: "127.0.0.1", port: 3000 }])
	const second = await resolveBackend(env)
	expect(second.port).toBe(first.port)
	expect(second.token).toBe(first.token)
})

it("serializes simultaneous launchers when the preferred port belongs to another service", async () => {
	const occupied = createHttpServer((_req, res) => {
		res.writeHead(403)
		res.end()
	})
	servers.push(occupied)
	await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
	const address = occupied.address()
	if (!address || typeof address === "string")
		throw new Error("Expected TCP port")
	const env = await environment(address.port)
	const [first, second] = await Promise.all([
		resolveBackend(env),
		resolveBackend(env),
	])
	expect(first.port).not.toBe(address.port)
	expect(first.port).toBe(second.port)
	expect(first.addressFile).toBe(second.addressFile)
})

it("reuses an authenticated running backend instead of interpreting it as a port conflict", async () => {
	const env = await environment(3000)
	const initial = await resolveBackend(env)
	const running = createHttpServer((req, res) => {
		expect(req.headers["x-shutdown-token"]).toBe(initial.token)
		res.setHeader("content-type", "application/json")
		res.end(JSON.stringify({ configured: true, weakPassword: false }))
	})
	servers.push(running)
	await new Promise<void>((resolve) =>
		running.listen(initial.port, "127.0.0.1", resolve),
	)
	const attached = await resolveBackend(env)
	expect(attached.port).toBe(initial.port)
	expect(attached.running).toBe(true)
})

it("publishes a new port if an unrelated service takes the previous selection", async () => {
	const env = await environment(3000)
	const first = await resolveBackend(env)
	const occupied = createHttpServer((_req, res) => {
		res.writeHead(403)
		res.end()
	})
	servers.push(occupied)
	await new Promise<void>((resolve) =>
		occupied.listen(first.port, "127.0.0.1", resolve),
	)
	const next = await resolveBackend(env)
	expect(next.port).not.toBe(first.port)
	expect(next.addressFile).toBe(first.addressFile)
})
