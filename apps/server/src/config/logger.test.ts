import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pino } from "pino"
import { expect, test } from "vitest"
import { buildLoggerOptions, createLogger, REDACTED } from "./logger.ts"

function capture() {
	const chunks: string[] = []
	const stream = {
		write(chunk: string) {
			chunks.push(chunk)
		},
	}
	return { stream, chunks }
}

test("logger redacts cookie and authorization on req.headers", () => {
	const { stream, chunks } = capture()
	const log = createLogger({ level: "info", destination: stream })
	log.info(
		{
			req: {
				method: "POST",
				url: "/auth/login",
				headers: {
					cookie: "app_session=SECRET-COOKIE-VALUE",
					authorization: "Bearer SECRET-TOKEN",
					"x-password": "hunter2",
				},
			},
		},
		"request",
	)
	const out = chunks.join("")
	expect(out).not.toContain("SECRET-COOKIE-VALUE")
	expect(out).not.toContain("SECRET-TOKEN")
	expect(out).not.toContain("hunter2")
	expect(out).toContain(REDACTED)
})

test("logger redacts Set-Cookie on responses", () => {
	const { stream, chunks } = capture()
	const log = createLogger({ level: "info", destination: stream })
	log.info(
		{ res: { headers: { "set-cookie": "app_session=RAW-SESSION-ID" } } },
		"response",
	)
	const out = chunks.join("")
	expect(out).not.toContain("RAW-SESSION-ID")
	expect(out).toContain(REDACTED)
})

test("logger redacts password fields in payloads", () => {
	const { stream, chunks } = capture()
	const log = createLogger({ level: "info", destination: stream })
	log.info({ body: { password: "plaintext-password" } }, "login body")
	const out = chunks.join("")
	expect(out).not.toContain("plaintext-password")
	expect(out).toContain(REDACTED)
})

test("source logger uses pino-roll transports for file output", () => {
	const opts = buildLoggerOptions({
		fromBundle: false,
		logsDir: "/tmp/unused-logs",
		nodeEnv: "production",
		level: "info",
	})
	expect(opts.stream).toBeUndefined()
	expect(opts.transport).toEqual({
		targets: [
			expect.objectContaining({ target: "pino-roll", level: "info" }),
			expect.objectContaining({ target: "pino-roll", level: "error" }),
		],
	})
})

test("bundled logger writes rolling files instead of pino-roll transports", () => {
	const dir = mkdtempSync(join(tmpdir(), "app-logs-"))
	try {
		const opts = buildLoggerOptions({
			fromBundle: true,
			logsDir: dir,
			nodeEnv: "production",
			level: "info",
		})
		expect(opts.transport).toBeUndefined()
		expect(opts.stream).toBeDefined()
		const log = pino(opts, opts.stream)
		log.info("hello-from-bundle")
		log.error("boom-from-bundle")
		const files = readdirSync(dir)
		expect(
			files.some((name) => /^app\.\d{4}-\d{2}-\d{2}\.log$/.test(name)),
		).toBe(true)
		expect(
			files.some((name) => /^app\.error\.\d{4}-\d{2}-\d{2}\.log$/.test(name)),
		).toBe(true)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})
