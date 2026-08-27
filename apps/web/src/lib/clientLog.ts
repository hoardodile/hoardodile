import { detectPlatform } from "@/features/usage/detectPlatform"
import { APP_VERSION } from "@/lib/appInfo"
import { trpcMutate } from "@/trpc/factory"

export type ClientLogLevel = "error" | "warn" | "info"

export type ClientLogEntry = {
	readonly ts: number
	readonly level: ClientLogLevel
	readonly message: string
	readonly stack?: string
}

/** Wire shape of the `diagnostics.clientLog` procedure input. */
type WireLogEntry = {
	readonly ts: number
	readonly level: "error" | "warn"
	readonly message: string
	readonly stack?: string
}

/**
 * App-local frontend log: a ring buffer of console/window/React errors that
 * serves two consumers — the Settings → About "Copy diagnostics" export and
 * a best-effort push into the server's own log files (same origin, same
 * machine; never an external host, see the privacy note below).
 *
 * The tail is mirrored to localStorage (throttled) so a renderer crash that
 * ends in a reload still leaves the error trace available to the user under
 * About → Report a bug.
 */
const RING_CAPACITY = 200
const MIRROR_CAPACITY = 50
const MIRROR_KEY = "hoardodile.clientlog"
const MIRROR_WRITE_MS = 1_000
const PUSH_INTERVAL_MS = 15_000
const MAX_PUSH_ENTRIES = 50
const MAX_MESSAGE_LENGTH = 1_000
const MAX_STACK_LENGTH = 4_000
const MIRROR_STACK_LENGTH = 1_000

const entries: ClientLogEntry[] = []
let sentCount = 0
let initialised = false
let mirrorTimer: ReturnType<typeof setTimeout> | undefined
let pushInFlight = false

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function append(entry: ClientLogEntry): void {
	entries.push(entry)
	if (entries.length > RING_CAPACITY) {
		const overflow = entries.length - RING_CAPACITY
		entries.splice(0, overflow)
		sentCount = Math.max(0, sentCount - overflow)
	}
	scheduleMirrorWrite()
}

function scheduleMirrorWrite(): void {
	if (mirrorTimer !== undefined) return
	mirrorTimer = setTimeout(() => {
		mirrorTimer = undefined
		persistMirror()
	}, MIRROR_WRITE_MS)
}

function persistMirror(): void {
	try {
		const tail = entries.slice(-MIRROR_CAPACITY).map((entry) => ({
			ts: entry.ts,
			level: entry.level,
			message: truncate(entry.message, MAX_MESSAGE_LENGTH),
			...(entry.stack !== undefined
				? { stack: truncate(entry.stack, MIRROR_STACK_LENGTH) }
				: {}),
		}))
		localStorage.setItem(
			MIRROR_KEY,
			JSON.stringify({ entries: tail, sent: sentCount }),
		)
	} catch {
		// Quota / privacy-mode errors: the memory ring keeps working.
	}
}

function restoreMirror(): void {
	try {
		const raw = localStorage.getItem(MIRROR_KEY)
		if (raw === null) return
		const parsed: unknown = JSON.parse(raw)
		if (typeof parsed !== "object" || parsed === null) return
		const payload = parsed as Record<string, unknown>
		const list = payload.entries
		if (!Array.isArray(list) || list.length > MIRROR_CAPACITY) return
		for (const item of list) {
			if (!isMirrorEntry(item)) continue
			entries.push({
				ts: item.ts,
				level: item.level,
				message: truncate(item.message, MAX_MESSAGE_LENGTH),
				...(item.stack !== undefined ? { stack: item.stack } : {}),
			})
		}
		// Keep the cursor so entries recorded right before a crash (and never
		// pushed) still reach the server log after the reboot — only entries
		// the previous boot already pushed stay skipped.
		const restoredSent =
			typeof payload.sent === "number" &&
			Number.isFinite(payload.sent) &&
			payload.sent >= 0
				? payload.sent
				: entries.length
		sentCount = Math.min(restoredSent, entries.length)
	} catch {
		// Corrupt or inaccessible mirror: start from an empty ring.
	}
}

function isMirrorEntry(value: unknown): value is ClientLogEntry {
	if (typeof value !== "object" || value === null) return false
	const entry = value as Record<string, unknown>
	return (
		typeof entry.ts === "number" &&
		(entry.level === "error" ||
			entry.level === "warn" ||
			entry.level === "info") &&
		typeof entry.message === "string" &&
		(entry.stack === undefined || typeof entry.stack === "string")
	)
}

/**
 * Record a client log entry: console.error/warn, window errors and
 * unhandled rejections, or explicit reports (React error boundaries).
 * Safe to call before `initClientLogging` (the entry just joins the ring).
 */
export function pushClientLog(
	level: ClientLogLevel,
	message: string,
	stack?: string,
): void {
	const trimmed = message.trim()
	if (trimmed.length === 0) return
	append({
		ts: Date.now(),
		level,
		message: truncate(trimmed, MAX_MESSAGE_LENGTH),
		...(stack !== undefined && stack.length > 0
			? { stack: truncate(stack, MAX_STACK_LENGTH) }
			: {}),
	})
}

/**
 * Install the window-level capture hooks (idempotent). Called once from
 * `main.tsx` before the app renders so the earliest failures are caught.
 */
export function initClientLogging(): void {
	if (initialised) return
	initialised = true
	restoreMirror()

	window.addEventListener("error", (event) => {
		// Resource load errors carry no message — pure noise, skip them.
		if (event.message === undefined || event.message.length === 0) return
		const error = event.error
		pushClientLog(
			"error",
			event.message,
			error instanceof Error ? (error.stack ?? undefined) : undefined,
		)
	})
	window.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason
		pushClientLog(
			"error",
			reason instanceof Error ? reason.message : String(reason),
			reason instanceof Error ? reason.stack : undefined,
		)
	})

	// Capture console.error/console.warn without silencing them.
	const originalConsole = { ...console }
	console.error = (...args: unknown[]) => {
		originalConsole.error(...args)
		pushClientLog("error", formatArgs(args))
	}
	console.warn = (...args: unknown[]) => {
		originalConsole.warn(...args)
		pushClientLog("warn", formatArgs(args))
	}

	setInterval(() => {
		void flushClientLogToServer()
	}, PUSH_INTERVAL_MS)
	window.addEventListener("pagehide", () => {
		persistMirror()
		void flushClientLogToServer()
	})
}

function formatArgs(args: readonly unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === "string") return arg.trim()
			if (arg instanceof Error) return arg.message
			try {
				return JSON.stringify(arg)
			} catch {
				return String(arg)
			}
		})
		.filter((part) => part.length > 0)
		.join(" ")
}

/**
 * Push unsent error/warn entries into the server's log files
 * (`diagnostics.clientLog`). Best effort and silent: no session or an
 * offline server just leaves the cursor untouched for the next attempt.
 */
export async function flushClientLogToServer(): Promise<void> {
	if (pushInFlight || entries.length <= sentCount) return
	// The window (up to MAX_PUSH_ENTRIES) is what gets consumed — the
	// cursor advances past the whole window, not past the filtered batch,
	// so an info-only window cannot block the sendable entries behind it.
	const windowed = entries.slice(sentCount, sentCount + MAX_PUSH_ENTRIES)
	const batch = windowed.flatMap((entry): WireLogEntry[] => {
		if (entry.level !== "error" && entry.level !== "warn") return []
		return [
			{
				ts: entry.ts,
				level: entry.level,
				message: truncate(entry.message, MAX_MESSAGE_LENGTH),
				...(entry.stack !== undefined
					? { stack: truncate(entry.stack, MAX_STACK_LENGTH) }
					: {}),
			},
		]
	})
	if (batch.length === 0) {
		sentCount += windowed.length
		return
	}
	pushInFlight = true
	try {
		await trpcMutate("diagnostics", "clientLog", { entries: batch })
		sentCount += windowed.length
	} catch {
		// Leave the cursor: the next interval retries.
	} finally {
		pushInFlight = false
	}
}

/**
 * The diagnostics block the user copies when filing an issue: app identity,
 * platform, origin and the recent frontend log tail. Purely local text —
 * server-side material (app.log) is fetched by the user (logs folder on
 * desktop, `STORAGE_ROOT/local/logs` when self-hosting).
 */
export function formatDiagnostics(count = 100): string {
	const lines: string[] = []
	lines.push(`hoardodile v${APP_VERSION}`)
	lines.push(`Platform: ${detectPlatform()}`)
	if (typeof navigator !== "undefined") {
		lines.push(`User agent: ${navigator.userAgent}`)
	}
	if (typeof window !== "undefined") {
		lines.push(`Server: ${window.location.origin}`)
	}
	lines.push(`Time: ${new Date().toISOString()}`)
	lines.push("")
	lines.push(`--- Frontend log (last ${count}) ---`)
	const tail = entries.slice(-count)
	if (tail.length === 0) {
		lines.push("(no entries)")
	} else {
		for (const entry of tail) {
			const time = formatTime(entry.ts)
			lines.push(`[${time}] ${entry.level}: ${entry.message}`)
			if (entry.stack !== undefined && entry.stack.length > 0) {
				lines.push(`  ${entry.stack.split("\n").slice(0, 3).join("\n  ")}`)
			}
		}
	}
	return lines.join("\n")
}

function formatTime(ts: number): string {
	const date = new Date(ts)
	const pad = (value: number): string => String(value).padStart(2, "0")
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`
}
