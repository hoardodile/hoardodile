import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "src/config/env.ts"
import { launchHttpServer } from "src/runtime.ts"
import { expect, it } from "vitest"
import { acquireStorageInstance } from "./instance-lock.ts"

it("refuses an occupied shared dev port and releases the library for a retry", async () => {
	const root = await mkdtemp(join(tmpdir(), "shared-development-"))
	const occupied = createServer()
	await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
	const address = occupied.address()
	if (!address || typeof address === "string")
		throw new Error("Expected TCP address")
	try {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			HOST: "127.0.0.1",
			PORT: String(address.port),
			STORAGE_ROOT: root,
			HOARDODILE_DEV_BACKEND: "shared",
			DISABLE_DEV_PLUGINS: "true",
		})
		await expect(launchHttpServer({ env })).rejects.toMatchObject({
			code: "EADDRINUSE",
		})
		const release = acquireStorageInstance(root)
		release()
		await new Promise<void>((resolve, reject) =>
			occupied.close((error) => (error ? reject(error) : resolve())),
		)
		const launched = await launchHttpServer({ env })
		try {
			expect(launched.port).toBe(address.port)
			expect((await fetch(`http://127.0.0.1:${address.port}/health`)).ok).toBe(
				true,
			)
		} finally {
			await launched.built.close()
		}
	} finally {
		if (occupied.listening)
			await new Promise<void>((resolve) => occupied.close(() => resolve()))
		await rm(root, { recursive: true, force: true })
	}
}, 30000)
