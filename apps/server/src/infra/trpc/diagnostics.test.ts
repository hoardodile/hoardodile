import { describe, expect, test, vi } from "vitest"
import { buildDomainRouter } from "./router.ts"

type LogSpy = {
	readonly error: ReturnType<typeof vi.fn>
	readonly warn: ReturnType<typeof vi.fn>
}

function makeLog(): LogSpy {
	return { error: vi.fn(), warn: vi.fn() }
}

function makeContext(log: LogSpy, authenticated = true) {
	return {
		authenticated,
		req: { log, server: { readOnly: false } },
		res: {},
		env: {},
		sessionId: undefined,
	} as never
}

// The diagnostics router needs no services; every other sub-router is
// constructed with undefined services (none of them are touched here).
const router = buildDomainRouter({} as never)

describe("diagnostics.clientLog", () => {
	test("requires a session", async () => {
		const caller = router.createCaller(makeContext(makeLog(), false))
		await expect(
			caller.diagnostics.clientLog({
				entries: [{ ts: 1, level: "error", message: "boom" }],
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" })
	})

	test("logs each entry through pino at its own level", async () => {
		const log = makeLog()
		const caller = router.createCaller(makeContext(log))
		await caller.diagnostics.clientLog({
			entries: [
				{
					ts: 1_700_000_000_000,
					level: "error",
					message: "boom",
					stack: "stack-trace",
				},
				{ ts: 1_700_000_000_001, level: "warn", message: "careful" },
			],
		})
		expect(log.error).toHaveBeenCalledWith(
			expect.objectContaining({
				src: "client",
				clientTs: 1_700_000_000_000,
				stack: "stack-trace",
			}),
			"boom",
		)
		expect(log.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				src: "client",
				clientTs: 1_700_000_000_001,
			}),
			"careful",
		)
	})

	test("rejects oversized and malformed batches", async () => {
		const caller = router.createCaller(makeContext(makeLog()))
		const oversized = Array.from({ length: 51 }, (_, i) => ({
			ts: i + 1,
			level: "warn" as const,
			message: `m${i}`,
		}))
		await expect(
			caller.diagnostics.clientLog({ entries: oversized }),
		).rejects.toThrow()
		await expect(
			caller.diagnostics.clientLog({ entries: [] }),
		).rejects.toThrow()
		await expect(
			caller.diagnostics.clientLog({
				entries: [{ ts: -1, level: "error", message: "x" }],
			}),
		).rejects.toThrow()
	})
})
