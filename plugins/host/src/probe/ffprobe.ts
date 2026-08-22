/**
 * Shared ffprobe plumbing for the media probes. `video.ts` and `audio.ts`
 * both spawn the same binary with the same JSON output flags and only
 * differ in how they read the payload, so the process handling and the
 * payload shapes live here.
 *
 * The ffprobe binary path is resolved lazily. `@derhuerst/ffprobe-static`
 * is an optional dependency of this package — not shipped in the host
 * tarball. Dev resolves it from this package's `node_modules`; `pnpm
 * start` and the desktop sidecar resolve it from the server
 * `dist/node_modules` copy.
 */
import { createRequire } from "node:module"
import type { Readable } from "node:stream"
import { execa } from "execa"

type ResolveFfprobeDeps = {
	readonly env?: NodeJS.ProcessEnv
	/** Override for tests so they never hit the real module. */
	readonly loadStatic?: () => string | undefined
}

const requireCjs = createRequire(import.meta.url)

/**
 * Resolve the absolute path to `ffprobe` for this host.
 *
 * Precedence:
 *   1. The `FFPROBE_PATH` env var.
 *   2. `@derhuerst/ffprobe-static` via lazy `createRequire` — the
 *      installer package stays out of the host tarball.
 *   3. A bare command name, letting operators with ffprobe on PATH run
 *      the CLI or server directly.
 */
export function resolveFfprobePath(deps: ResolveFfprobeDeps = {}): string {
	const env = deps.env ?? process.env
	const fromEnv = env.FFPROBE_PATH
	if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
	const staticPath = (deps.loadStatic ?? loadInstallerFfprobe)()
	return staticPath ?? "ffprobe"
}

function loadInstallerFfprobe(): string | undefined {
	try {
		const mod: unknown = requireCjs("@derhuerst/ffprobe-static")
		if (typeof mod === "string" && mod.length > 0) return mod
		if (
			mod !== null &&
			typeof mod === "object" &&
			"path" in mod &&
			typeof (mod as { path: unknown }).path === "string"
		) {
			return (mod as { path: string }).path
		}
		return undefined
	} catch {
		return undefined
	}
}

let ffprobePathCache: string | undefined

/** Memoized {@link resolveFfprobePath} for the probe entry points. */
export function getFfprobePath(): string {
	if (ffprobePathCache === undefined) ffprobePathCache = resolveFfprobePath()
	return ffprobePathCache
}

export type FfprobeStream = {
	readonly codec_type?: unknown
	readonly codec_name?: unknown
	readonly width?: unknown
	readonly height?: unknown
	readonly sample_rate?: unknown
	readonly channels?: unknown
	readonly disposition?: unknown
	readonly tags?: unknown
}

export type FfprobeFormat = {
	readonly duration?: unknown
	readonly bit_rate?: unknown
	readonly tags?: unknown
}

export type FfprobePayload = {
	readonly streams?: readonly FfprobeStream[]
	readonly format?: FfprobeFormat
}

/**
 * Parse ffprobe's JSON output into the raw payload shape. Anything that
 * is not a JSON object yields an empty payload — partial and malformed
 * payloads are normal for damaged media, and callers prefer surfacing
 * whatever survives narrowing over rejecting the whole probe.
 */
export function parseFfprobePayload(json: string): FfprobePayload {
	const payload: unknown = JSON.parse(json)
	if (typeof payload !== "object" || payload === null) return {}
	return payload
}

/** Read `format.duration` (ffprobe emits it as a string) in milliseconds. */
export function ffprobeDurationMs(
	format: FfprobeFormat | undefined,
): number | undefined {
	const raw = format?.duration
	if (typeof raw !== "string") return undefined
	const seconds = Number.parseFloat(raw)
	if (!Number.isFinite(seconds) || seconds < 0) return undefined
	return Math.round(seconds * 1000)
}

/** Read a positive integer out of an ffprobe field (string or number). */
export function ffprobeInt(value: unknown): number | undefined {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Number.parseInt(value, 10)
				: Number.NaN
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined
	return Math.round(parsed)
}

/**
 * Run `ffprobe` against `source` and return its parsed JSON payload.
 * Failure paths reject (callers wrap the call and treat a missing probe
 * as non-fatal) so this function only returns with a payload in hand.
 *
 * Why JSON / `-print_format json`: the alternative `-show_entries` flat
 * format requires brittle line splitting and breaks on locale-specific
 * decimal separators in `duration`. JSON gives the values verbatim.
 *
 * @throws `Error` with stderr when ffprobe exits non-zero or emits no JSON.
 */
export function runFfprobeJson(
	source: string | Readable,
	ffprobePath: string,
	inputFormat?: string,
): Promise<FfprobePayload> {
	const fromStream = typeof source !== "string"
	return new Promise((resolve, reject) => {
		const args = [
			"-hide_banner",
			"-loglevel",
			"error",
			"-print_format",
			"json",
			"-show_streams",
			"-show_format",
		]
		if (fromStream) {
			if (inputFormat === undefined) {
				reject(new Error("stream ffprobe requires an input format hint"))
				return
			}
			args.push("-probesize", "100M", "-analyzeduration", "100M")
			args.push("-f", inputFormat)
		}
		args.push(fromStream ? "pipe:0" : source)
		const child = execa(ffprobePath, args, {
			stdin: fromStream ? "pipe" : "ignore",
			reject: false,
			stripFinalNewline: false,
		})
		if (fromStream) {
			source.on("error", reject)
			const stdin = child.stdin
			if (stdin !== null) {
				source.pipe(stdin)
				stdin.on("error", () => {})
			}
		}
		void child.then(
			({ stdout, exitCode, stderr }) => {
				if (exitCode !== 0) {
					const msg = stderr.trim()
					reject(
						new Error(`ffprobe exited ${exitCode}${msg ? `: ${msg}` : ""}`),
					)
					return
				}
				if (stdout.length === 0) {
					reject(new Error("ffprobe produced no output"))
					return
				}
				try {
					resolve(parseFfprobePayload(stdout))
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)))
				}
			},
			(err) => reject(err instanceof Error ? err : new Error(String(err))),
		)
	})
}
