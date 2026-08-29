import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { serveWorkbench } from "../scripts/serve.mjs"

/**
 * Guards the no-abort promise of the workbench server: if the requested
 * port is already in use, `serveWorkbench` rebinds to the next free port
 * and keeps serving (never hangs or rejects). Works in the node env the
 * package's vitest config uses.
 */

const servers: Server[] = []

function track(server: Server): Server {
	servers.push(server)
	return server
}

afterEach(async () => {
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((resolveClose) => server.close(() => resolveClose())),
		),
	)
	servers.length = 0
})

function boundPort(server: Server): number {
	const address = server.address()
	if (address === null || typeof address === "string") {
		throw new Error("server has no bound port")
	}
	return address.port
}

describe("serveWorkbench port rebind", () => {
	it("rebinds to the next free port when the requested one is in use", async () => {
		const blocker = track(createServer(() => {}))
		await new Promise<void>((resolveListen) =>
			blocker.listen(0, "127.0.0.1", resolveListen),
		)
		const busyPort = boundPort(blocker)

		const workbench = track(
			await serveWorkbench({
				port: busyPort,
				host: "127.0.0.1",
				providers: { resources: () => [] },
			}),
		)

		const bound = boundPort(workbench)
		expect(workbench.listening).toBe(true)
		expect(bound).not.toBe(busyPort)
		expect(bound).toBeGreaterThan(busyPort)
	})
})
