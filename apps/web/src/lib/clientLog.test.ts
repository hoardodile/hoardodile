import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { trpcMutateMock } = vi.hoisted(() => ({ trpcMutateMock: vi.fn() }))

vi.mock("@/trpc/factory", () => ({ trpcMutate: trpcMutateMock }))

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

/** Fresh module per test: the ring buffer and the init guard are module state. */
async function loadClientLog() {
	vi.resetModules()
	return await import("./clientLog")
}

function rejectEvent(reason: unknown): Event {
	const event = new Event("unhandledrejection")
	Object.defineProperty(event, "reason", { value: reason })
	return event
}

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.clear()
})

afterEach(() => {
	console.error = originalConsoleError
	console.warn = originalConsoleWarn
})

describe("clientLog", () => {
	it("captures console.error and console.warn without silencing them", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const clientLog = await loadClientLog()
		clientLog.initClientLogging()

		console.error("crash: ", new Error("boom"))
		console.warn("careful")

		const block = clientLog.formatDiagnostics()
		expect(block).toContain("crash: boom")
		expect(block).toContain("warn: careful")
		expect(errorSpy).toHaveBeenCalledWith("crash: ", new Error("boom"))
		expect(warnSpy).toHaveBeenCalledWith("careful")
	})

	it("captures window errors and unhandled rejections", async () => {
		const clientLog = await loadClientLog()
		clientLog.initClientLogging()

		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "render crashed",
				error: new Error("render crashed"),
			}),
		)
		window.dispatchEvent(rejectEvent(new Error("promise boom")))

		const block = clientLog.formatDiagnostics()
		expect(block).toContain("error: render crashed")
		expect(block).toContain("error: promise boom")
	})

	it("mirrors the tail and cursor to localStorage and restores unsent entries on the next boot", async () => {
		vi.useFakeTimers()
		try {
			const clientLog = await loadClientLog()
			clientLog.initClientLogging()
			clientLog.pushClientLog("error", "pre-crash evidence")
			vi.advanceTimersByTime(1_100)

			const persisted = JSON.parse(
				localStorage.getItem("hoardodile.clientlog") ?? "{}",
			)
			expect(persisted.entries).toHaveLength(1)
			expect(persisted.entries[0]).toMatchObject({ level: "error" })
			expect(persisted.sent).toBe(0)

			// A fresh boot (crash + reload) restores the mirror — and an
			// entry that was never pushed still reaches the server: the
			// cursor keeps the "unsent" flag instead of swallowing it.
			const nextBoot = await loadClientLog()
			nextBoot.initClientLogging()
			expect(nextBoot.formatDiagnostics()).toContain(
				"error: pre-crash evidence",
			)
			await nextBoot.flushClientLogToServer()
			expect(trpcMutateMock).toHaveBeenCalledTimes(1)
			const input = trpcMutateMock.mock.calls[0]![2] as {
				entries: Array<{ message: string }>
			}
			expect(input.entries[0]!.message).toContain("pre-crash evidence")
		} finally {
			vi.useRealTimers()
		}
	})

	it("formats the diagnostics block with identity and entries", async () => {
		const clientLog = await loadClientLog()
		clientLog.pushClientLog("error", "boom", "stack line 1\nstack line 2")

		const block = clientLog.formatDiagnostics()
		expect(block).toContain("hoardodile v")
		expect(block).toContain("Platform:")
		expect(block).toContain("error: boom")
		expect(block).toContain("stack line 1")
	})

	it("masks the app origin in reports unless it is loopback", async () => {
		const clientLog = await loadClientLog()
		expect(clientLog.originForReport("http://127.0.0.1:3000")).toBe(
			"http://127.0.0.1:3000",
		)
		expect(clientLog.originForReport("http://localhost:3000")).toBe(
			"http://localhost:3000",
		)
		expect(clientLog.originForReport("http://[::1]:3000")).toBe(
			"http://[::1]:3000",
		)
		expect(clientLog.originForReport("http://nas.local:3000")).toBe("<server>")
		expect(clientLog.originForReport("https://archive.example.com")).toBe(
			"<server>",
		)
	})

	it("pushes unsent error/warn entries once and retries a failure", async () => {
		const clientLog = await loadClientLog()
		clientLog.pushClientLog("info", "noise")
		clientLog.pushClientLog("error", "first error")
		clientLog.pushClientLog("warn", "first warn")

		trpcMutateMock.mockRejectedValueOnce(new Error("server down"))
		await clientLog.flushClientLogToServer()
		expect(trpcMutateMock).toHaveBeenCalledTimes(1)
		expect(trpcMutateMock.mock.calls[0]![0]).toBe("diagnostics")
		expect(trpcMutateMock.mock.calls[0]![1]).toBe("clientLog")
		// On failure the cursor is untouched: the whole batch is retried.
		const failedInput = trpcMutateMock.mock.calls[0]![2] as {
			entries: Array<{ level: string }>
		}
		expect(
			failedInput.entries.map((entry: { level: string }) => entry.level),
		).toEqual(["error", "warn"])

		await clientLog.flushClientLogToServer()
		expect(trpcMutateMock).toHaveBeenCalledTimes(2)
		// Success advances the cursor past the pushed batch: no duplicates.
		await clientLog.flushClientLogToServer()
		expect(trpcMutateMock).toHaveBeenCalledTimes(2)
	})

	it("drops empty messages and caps the ring", async () => {
		const clientLog = await loadClientLog()
		clientLog.pushClientLog("error", "   ")

		for (let i = 0; i < 250; i += 1) {
			clientLog.pushClientLog("info", `entry ${i}`)
		}
		const block = clientLog.formatDiagnostics()
		expect(block).not.toContain("error: ")
		// The ring keeps the newest 200; the default export tail is the last 100.
		expect(block).toContain("info: entry 249")
		expect(block).not.toContain("info: entry 0")

		const exportDump = clientLog.formatDiagnostics(200)
		const entryLines = exportDump
			.split("\n")
			.filter((line: string) => line.startsWith("["))
		expect(entryLines).toHaveLength(200)
	})
})
