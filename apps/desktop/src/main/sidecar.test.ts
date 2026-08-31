import { createServer } from "node:net"
import getPort from "get-port"
import { describe, expect, it, vi } from "vitest"
import { resolveListenPort } from "./sidecar.ts"

vi.mock("get-port", () => ({ default: vi.fn() }))

const getPortMock = vi.mocked(getPort)
const HOST = "127.0.0.1" as const

/** An OS-assigned free port on the test host, released again immediately. */
async function freePort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve) => server.listen(0, HOST, () => resolve()))
	const { port } = server.address() as { port: number }
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

/** Hold `port` open so a fresh bind on it fails; returns a release fn. */
async function holdPort(port: number): Promise<() => Promise<void>> {
	const server = createServer()
	await new Promise<void>((resolve) =>
		server.listen(port, HOST, () => resolve()),
	)
	return () => new Promise<void>((resolve) => server.close(() => resolve()))
}

describe("resolveListenPort", () => {
	it("keeps the preferred port when it is bindable (no drift through TIME_WAIT)", async () => {
		const port = await freePort()
		// get-port is never consulted when the real bind succeeds.
		getPortMock.mockResolvedValue(0)
		await expect(resolveListenPort(HOST, port)).resolves.toBe(port)
		expect(getPortMock).not.toHaveBeenCalled()
	})

	it("falls back to a free port only when the preferred port is genuinely held", async () => {
		const port = await freePort()
		const release = await holdPort(port)
		try {
			getPortMock.mockResolvedValue(9000)
			await expect(resolveListenPort(HOST, port)).resolves.toBe(9000)
			expect(getPortMock).toHaveBeenCalledWith({ host: HOST })
		} finally {
			await release()
		}
	})
})
