import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test, vi } from "vitest"
import { buildDomainRouter } from "./router.ts"

type LogSpy = {
	readonly error: ReturnType<typeof vi.fn>
	readonly warn: ReturnType<typeof vi.fn>
}

function makeLog(): LogSpy {
	return { error: vi.fn(), warn: vi.fn() }
}

function makeContext(
	log: LogSpy,
	authenticated = true,
	paths?: { readonly root: string; readonly logsDir: string },
) {
	return {
		authenticated,
		req: {
			log,
			server: {
				readOnly: false,
				...(paths !== undefined
					? {
							paths: {
								root: paths.root,
								local: { logs: () => paths.logsDir },
							},
						}
					: {}),
			},
		},
		res: {},
		env: {},
		sessionId: undefined,
	} as never
}

function makeLogsFixture() {
	const root = mkdtempSync(join(tmpdir(), "hoardodile-diagnostics-"))
	const logsDir = join(root, "local", "logs")
	mkdirSync(logsDir, { recursive: true })
	return {
		root,
		logsDir,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	}
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

describe("diagnostics.logs", () => {
	test("requires a session", async () => {
		const fixture = makeLogsFixture()
		try {
			const caller = router.createCaller(
				makeContext(makeLog(), false, {
					root: fixture.root,
					logsDir: fixture.logsDir,
				}),
			)
			await expect(caller.diagnostics.logs()).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			})
		} finally {
			fixture.cleanup()
		}
	})

	test("returns the rolling log files redacted for paths and private IPs", async () => {
		const fixture = makeLogsFixture()
		try {
			writeFileSync(
				join(fixture.logsDir, "app.2026-08-27.1.log"),
				`path=${fixture.root}\\local\\logs is the root\nip=192.168.1.5 public=8.8.8.8\n`,
			)
			writeFileSync(
				join(fixture.logsDir, "app.error.2026-08-27.1.log"),
				"error line\n",
			)
			writeFileSync(join(fixture.logsDir, "ignore.txt"), "not a log\n")

			const caller = router.createCaller(
				makeContext(makeLog(), true, {
					root: fixture.root,
					logsDir: fixture.logsDir,
				}),
			)
			const result = await caller.diagnostics.logs()
			expect(result.files.map((file) => file.name)).toEqual([
				"app.2026-08-27.1.log",
				"app.error.2026-08-27.1.log",
			])
			const content = result.files[0]!.content
			expect(content).toContain("<storage>")
			expect(content).not.toContain(fixture.root)
			expect(content).toContain("<ip>")
			expect(content).not.toContain("192.168.1.5")
			// Public addresses stay intact — only RFC 1918 ranges are masked.
			expect(content).toContain("8.8.8.8")
		} finally {
			fixture.cleanup()
		}
	})

	test("keeps only the most recent log files", async () => {
		const fixture = makeLogsFixture()
		try {
			for (let day = 1; day <= 14; day += 1) {
				const stamp = `2026-08-${String(day).padStart(2, "0")}`
				writeFileSync(
					join(fixture.logsDir, `app.${stamp}.1.log`),
					`day ${day}\n`,
				)
			}
			const caller = router.createCaller(
				makeContext(makeLog(), true, {
					root: fixture.root,
					logsDir: fixture.logsDir,
				}),
			)
			const result = await caller.diagnostics.logs()
			expect(result.files).toHaveLength(12)
			expect(result.files[0]!.name).toBe("app.2026-08-03.1.log")
			expect(result.files[11]!.name).toBe("app.2026-08-14.1.log")
		} finally {
			fixture.cleanup()
		}
	})
})
