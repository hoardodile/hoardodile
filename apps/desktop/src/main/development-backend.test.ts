import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import {
	connectDevelopmentBackend,
	readDevelopmentBackend,
} from "./development-backend.ts"
import { readSidecarAuthConfigured } from "./sidecar.ts"

const environment = {
	HOARDODILE_DEV_BACKEND_URL: "http://127.0.0.1:32123/",
	HOARDODILE_DEV_BACKEND_TOKEN: "a".repeat(64),
	HOARDODILE_DEV_STORAGE_ROOT: join(tmpdir(), "shared-dev-library"),
}

it("never attaches packaged applications to a development service", () => {
	expect(readDevelopmentBackend(true, environment)).toBeUndefined()
	expect(readDevelopmentBackend(false, {})).toBeUndefined()
})

it("rejects non-local addresses, credentials, missing tokens, and relative storage paths", () => {
	for (const url of [
		"https://example.com/",
		"http://user:pass@127.0.0.1:32123/",
		"http://127.0.0.1:32123/other",
	])
		expect(() =>
			readDevelopmentBackend(false, {
				...environment,
				HOARDODILE_DEV_BACKEND_URL: url,
			}),
		).toThrow()
	expect(() =>
		readDevelopmentBackend(false, {
			...environment,
			HOARDODILE_DEV_BACKEND_TOKEN: "",
		}),
	).toThrow()
	expect(() =>
		readDevelopmentBackend(false, {
			...environment,
			HOARDODILE_DEV_STORAGE_ROOT: "relative",
		}),
	).toThrow()
})

it("can attach before or after the shared server starts without shutting it down", async () => {
	const requests: string[] = []
	const server = createServer((req, res) => {
		requests.push(req.url ?? "")
		expect(req.headers["x-shutdown-token"]).toBe(
			environment.HOARDODILE_DEV_BACKEND_TOKEN,
		)
		res.setHeader("content-type", "application/json")
		res.end(JSON.stringify({ configured: true, weakPassword: false }))
	})
	const before = connectDevelopmentBackend(
		readDevelopmentBackend(false, environment)!,
	)
	await before.stop()
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	try {
		const address = server.address()
		if (!address || typeof address === "string")
			throw new Error("Expected TCP address")
		const backend = readDevelopmentBackend(false, {
			...environment,
			HOARDODILE_DEV_BACKEND_URL: `http://127.0.0.1:${address.port}/`,
		})!
		const first = connectDevelopmentBackend(backend),
			second = connectDevelopmentBackend(backend)
		expect(await readSidecarAuthConfigured(first)).toEqual({
			configured: true,
			weakPassword: false,
		})
		await first.stop()
		expect(await readSidecarAuthConfigured(second)).toEqual({
			configured: true,
			weakPassword: false,
		})
		await second.stop()
		expect(requests).toEqual([
			"/api/internal/auth-configured",
			"/api/internal/auth-configured",
		])
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		)
	}
})

it("follows a reassigned port while rejecting corrupt records and other libraries", async () => {
	const directory = await mkdtemp(join(tmpdir(), "development-address-"))
	const addressFile = join(directory, "address.json")
	const backend = readDevelopmentBackend(false, {
		...environment,
		HOARDODILE_DEV_BACKEND_FILE: addressFile,
	})!
	const handle = connectDevelopmentBackend(backend)
	try {
		expect(handle.port).toBe(32123)
		await writeFile(
			addressFile,
			JSON.stringify({
				version: 1,
				storageRoot: backend.storageRoot,
				port: 32124,
			}),
		)
		expect(handle.url).toBe("http://127.0.0.1:32124/")
		await writeFile(addressFile, "{")
		expect(handle.port).toBe(32124)
		await writeFile(
			addressFile,
			JSON.stringify({
				version: 1,
				storageRoot: join(directory, "another-library"),
				port: 32125,
			}),
		)
		expect(handle.port).toBe(32124)
		await writeFile(
			addressFile,
			JSON.stringify({
				version: 1,
				storageRoot: backend.storageRoot,
				port: 65536,
			}),
		)
		expect(handle.port).toBe(32124)
		await writeFile(
			addressFile,
			JSON.stringify({
				version: 1,
				storageRoot: backend.storageRoot,
				port: 32126,
			}),
		)
		expect(handle.port).toBe(32126)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
