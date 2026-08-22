import { mkdirSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import {
	type DestinationStream,
	destination,
	type Logger,
	type LoggerOptions,
	multistream,
	pino,
	type StreamEntry,
	type TransportTargetOptions,
} from "pino"

declare const __HOARD_SERVER_BUNDLE__: boolean

export const REDACTED = "[Redacted]"

/** Rolling file logs keep this many distinct days, matching the old pino-roll limit. */
const FILE_LOG_KEEP_DAYS = 7

export const redactPaths = [
	"req.headers.cookie",
	"req.headers.authorization",
	'req.headers["x-password"]',
	"res.headers['set-cookie']",
	"headers.cookie",
	"headers.authorization",
	'headers["x-password"]',
	"cookie",
	"authorization",
	"password",
	"body.password",
	"request.body.password",
]

/**
 * Build the pino {@link LoggerOptions} used by the Fastify app and scripts.
 *
 * Redaction paths cover cookie / authorization / password-bearing fields on
 * both requests and responses so sensitive material never lands in logs.
 */
export function loggerOptions(level?: string): LoggerOptions {
	return {
		level: level ?? process.env.LOG_LEVEL ?? "info",
		redact: {
			paths: redactPaths,
			censor: REDACTED,
			remove: false,
		},
		timestamp: pino.stdTimeFunctions.isoTime,
		base: undefined,
	}
}

export type CreateLoggerOptions = {
	level?: string
	destination?: DestinationStream
}

/**
 * Create a standalone pino {@link Logger} for use outside the Fastify app
 * (e.g. scripts or tests). Accepts an optional destination stream so tests
 * can capture output.
 */
export function createLogger(opts: CreateLoggerOptions = {}): Logger {
	return pino(loggerOptions(opts.level), opts.destination)
}

export type BuildLoggerOptionsInput = {
	level?: string
	logsDir?: string
	nodeEnv?: string
	/**
	 * Test override. When omitted, module-name transports are used from
	 * source and in-process destinations from the production bundle.
	 */
	fromBundle?: boolean
}

/**
 * Fastify's `logger` option accepts pino options plus an optional destination
 * stream. Bundled dest uses `stream` instead of `transport` because pino's
 * worker files are not on disk after the JS is inlined.
 */
export type AppLoggerOptions = LoggerOptions & {
	readonly stream?: DestinationStream
}

/**
 * Build pino {@link LoggerOptions} for the Fastify app, optionally wiring
 * pino-pretty (development TTY) and file transports (non-test environments).
 *
 * - Source + development + TTY → pino-pretty target
 * - Source + non-test + logsDir → `pino-roll` for `app.log` / `app.error.log`
 * - Bundled dist → in-process destinations (pino.transport cannot load
 *   `pino/lib/worker.js` once pino itself is inlined)
 *
 * Keeps the existing redaction and timestamp configuration.
 */
export function buildLoggerOptions(
	input: BuildLoggerOptionsInput = {},
): AppLoggerOptions {
	const level = input.level ?? process.env.LOG_LEVEL ?? "info"
	const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development"
	const fromBundle = input.fromBundle ?? runningFromServerBundle()
	if (fromBundle) return bundledLoggerOptions(level, nodeEnv, input.logsDir)
	return moduleTransportLoggerOptions(level, nodeEnv, input.logsDir)
}

function moduleTransportLoggerOptions(
	level: string,
	nodeEnv: string,
	logsDir: string | undefined,
): AppLoggerOptions {
	const targets: TransportTargetOptions[] = []

	if (nodeEnv === "development" && process.stdout.isTTY) {
		targets.push({
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss Z",
				ignore: "pid,hostname",
			},
			level,
		})
	}

	if (logsDir && nodeEnv !== "test") {
		targets.push(
			{
				target: "pino-roll",
				options: {
					file: join(logsDir, "app.log"),
					frequency: "daily",
					dateFormat: "yyyy-MM-dd",
					limit: { count: FILE_LOG_KEEP_DAYS },
					mkdir: true,
				},
				level: "info",
			},
			{
				target: "pino-roll",
				options: {
					file: join(logsDir, "app.error.log"),
					frequency: "daily",
					dateFormat: "yyyy-MM-dd",
					limit: { count: FILE_LOG_KEEP_DAYS },
					mkdir: true,
				},
				level: "error",
			},
		)
	}

	const base = loggerOptions(level)

	if (targets.length === 0) return base
	if (targets.length === 1) return { ...base, transport: targets[0] }
	return { ...base, transport: { targets } }
}

function bundledLoggerOptions(
	level: string,
	nodeEnv: string,
	logsDir: string | undefined,
): AppLoggerOptions {
	const base = loggerOptions(level)
	if (!logsDir || nodeEnv === "test") return base
	const streams: StreamEntry[] = [
		{ level: "info", stream: rollingFileDestination(logsDir, "app") },
		{ level: "error", stream: rollingFileDestination(logsDir, "app.error") },
	]
	return { ...base, stream: multistream(streams) }
}

/**
 * True when this module was emitted into `apps/server/dist`. Source runs
 * (vite-node, vitest) keep pino-roll / pino-pretty as module-name transports.
 */
function runningFromServerBundle(): boolean {
	return __HOARD_SERVER_BUNDLE__ === true
}

function rollingFileDestination(
	logsDir: string,
	stem: string,
): DestinationStream {
	mkdirSync(logsDir, { recursive: true })
	let stamp = todayStamp(new Date())
	let dest = openLogFile(logsDir, stem, stamp)
	pruneOldLogs(logsDir, stem, FILE_LOG_KEEP_DAYS)
	return {
		write(chunk: string) {
			const nowStamp = todayStamp(new Date())
			if (nowStamp !== stamp) {
				closeLogFile(dest)
				stamp = nowStamp
				dest = openLogFile(logsDir, stem, stamp)
				pruneOldLogs(logsDir, stem, FILE_LOG_KEEP_DAYS)
			}
			dest.write(chunk)
		},
	}
}

function openLogFile(
	logsDir: string,
	stem: string,
	stamp: string,
): DestinationStream {
	return destination({
		dest: join(logsDir, `${stem}.${stamp}.log`),
		mkdir: true,
		sync: true,
	})
}

function closeLogFile(dest: DestinationStream): void {
	if ("end" in dest && typeof dest.end === "function") dest.end()
}

function todayStamp(now: Date): string {
	const y = now.getFullYear()
	const m = String(now.getMonth() + 1).padStart(2, "0")
	const d = String(now.getDate()).padStart(2, "0")
	return `${y}-${m}-${d}`
}

function pruneOldLogs(logsDir: string, stem: string, keepDays: number): void {
	const prefix = `${stem}.`
	const suffix = ".log"
	const dated: string[] = []
	for (const name of readdirSync(logsDir)) {
		if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue
		const datePart = name.slice(prefix.length, name.length - suffix.length)
		if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue
		dated.push(name)
	}
	dated.sort()
	const stale = dated.slice(0, Math.max(0, dated.length - keepDays))
	for (const name of stale) {
		unlinkSync(join(logsDir, name))
	}
}
