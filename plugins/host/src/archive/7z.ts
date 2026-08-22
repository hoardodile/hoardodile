import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { invalid } from "../errors.ts"
import { SNIFF_WINDOW_BYTES, sniffContainerFormat } from "./format.ts"
import { decodeLegacyZipName } from "./name-decode.ts"
import { readFileRange } from "./zip-entries.ts"

/**
 * 7-Zip process wrapper for the extra archive formats (.7z/.rar/.xz) and
 * — since the whole-archive extraction switch — zip/tar/gzip as well.
 * The binary comes from the optional `@hoardodile/7z-bin` package
 * (downloaded at install time); when it is absent every function here
 * rejects with a clear "unavailable" error and callers degrade to
 * zip-only support via yauzl.
 *
 * Only whole-archive operations run through 7-Zip: listing with
 * `l -slt -ba` (fixed English fields, locale-independent) and full
 * extraction with `x -y`. Random-access entry streaming stays on the
 * native zip path, which 7-Zip cannot express.
 *
 * Legacy zip names (no UTF-8 flag) are not re-encoded by 7-Zip on every
 * platform — its POSIX builds pass the raw bytes through — so the host
 * decodes them as cp437 itself: the listing's `Path` values are decoded
 * byte-wise for zip archives (see {@link decodeLegacyZipName}), and the
 * extraction sites rename the on-disk files to match (see
 * `normalizeExtractedTree` in extract.ts). Listing output is still
 * forced to UTF-8 (`-sccUTF-8`) so 7-Zip's Windows build emits decoded
 * names as valid UTF-8 rather than console-codepage bytes.
 */

const requireCjs = createRequire(import.meta.url)

export const SEVEN_ZIP_PATH_ENV = "7Z_BIN_PATH"

export type SevenZipEntry = {
	readonly name: string
	readonly sizeBytes: number
	readonly folder: boolean
	readonly encrypted: boolean
}

/**
 * Resolve the absolute path of the 7-Zip binary, or `undefined` when the
 * optional package is not installed (install failed / skipped platform).
 */
export function resolveSevenZipPath(): string | undefined {
	const fromEnv = process.env[SEVEN_ZIP_PATH_ENV]
	if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
	try {
		const mod: unknown = requireCjs("@hoardodile/7z-bin")
		if (typeof mod === "string" && mod.length > 0) return mod
		return undefined
	} catch {
		return undefined
	}
}

function sevenZipUnavailable(): Error {
	return invalid(
		"resource.archive_open_failed",
		"7-Zip is not installed — install @hoardodile/7z-bin or set 7Z_BIN_PATH to enable archive extraction",
		{},
	)
}

/**
 * Run 7-Zip with `args`; rejects with a domain error on non-zero exit,
 * timeout, or spawn failure (missing binary, wrong-arch executable).
 * stdout is streamed and collected in memory (no maxBuffer ceiling —
 * `l -slt` on very large archives can exceed a fixed cap); `stderr` is
 * included in the message so operators can see the native error instead
 * of a bare exit code.
 */
function run7z(
	bin: string,
	args: readonly string[],
	timeoutMs: number,
): Promise<{ readonly stdout: Buffer }> {
	return new Promise((resolveDone, rejectDone) => {
		const child = spawn(bin, [...args], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		})
		const stdout: Buffer[] = []
		const stderr: Buffer[] = []
		let settled = false

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

		const fail = (err: Error): void => {
			if (settled) return
			settled = true
			rejectDone(err)
		}
		const timer = setTimeout(() => {
			child.kill()
			fail(
				invalid(
					"resource.archive_open_failed",
					`7-Zip timed out after ${timeoutMs}ms`,
					{ timeoutMs },
				),
			)
		}, timeoutMs)
		timer.unref()

		child.on("error", (err) => {
			fail(
				invalid(
					"resource.archive_open_failed",
					`could not start 7-Zip: ${err.message}`,
					{},
				),
			)
		})
		child.on("close", (code, signal) => {
			clearTimeout(timer)
			if (settled) return
			if (code === 0) {
				settled = true
				resolveDone({ stdout: Buffer.concat(stdout) })
				return
			}
			const detail =
				signal !== null ? `killed by ${signal}` : `exit ${code ?? "?"}`
			const tail = Buffer.concat(stderr)
				.toString("utf8")
				.trim()
				.split("\n")
				.at(-1)
			fail(
				invalid(
					"resource.archive_open_failed",
					`7-Zip ${detail}${tail !== undefined && tail.length > 0 ? `: ${tail}` : ""}`,
					{ code },
				),
			)
		})
	})
}

/** True when `encrypted` field from `-slt` marks an encrypted entry. */
function isEncryptedField(value: string): boolean {
	return value === "+"
}

/** Parse `l -slt -ba` output into per-entry records (blank-line separated). */
function parseSltListing(
	stdout: Buffer,
	legacyNames: boolean,
): SevenZipEntry[] {
	const entries: SevenZipEntry[] = []
	let name: string | undefined
	let sizeBytes = 0
	let folder = false
	let encrypted = false
	// latin1 round-trips every output byte losslessly, so the raw `Path`
	// value survives for the cp437 decode below (the UTF-8 pass-through
	// would replace invalid bytes with U+FFFD first).
	for (const line of stdout.toString("latin1").split(/\r?\n/)) {
		if (line.length === 0) {
			if (name !== undefined) {
				entries.push({ name, sizeBytes, folder, encrypted })
				name = undefined
			}
			continue
		}
		const sep = line.indexOf(" = ")
		if (sep < 0) continue
		const key = line.slice(0, sep)
		if (key === "Path") {
			// 7za prints backslash separators on Windows; normalize to
			// the forward-slash convention used across the archive runtime.
			const raw = Buffer.from(line.slice(sep + 3), "latin1")
			const decoded = legacyNames
				? decodeLegacyZipName(raw)
				: raw.toString("utf8")
			name = decoded.replace(/\\/g, "/")
			continue
		}
		const value = line.slice(sep + 3)
		switch (key) {
			case "Size":
				sizeBytes = Number.parseInt(value, 10) || 0
				break
			case "Attributes":
				// Directories carry `D` (there is no Folder field in -slt).
				folder = value.includes("D")
				break
			case "Encrypted":
				encrypted = isEncryptedField(value)
				break
		}
	}
	if (name !== undefined) {
		entries.push({ name, sizeBytes, folder, encrypted })
	}
	return entries
}

/**
 * Per-call options for the 7-Zip wrappers.
 */
export type SevenZipRunOptions = {
	readonly timeoutMs?: number
}

/**
 * True when `archivePath`'s magic bytes say zip. Read once per call (a
 * 4KB window) to decide whether names decode as legacy cp437 (see
 * {@link decodeLegacyZipName}) — callers never need to know the format.
 * An unreadable header degrades to "not zip" (no cp437 fallback), which
 * is the safe direction for every other format.
 */
async function isZipArchive(archivePath: string): Promise<boolean> {
	const head = await readFileRange(
		archivePath,
		0,
		SNIFF_WINDOW_BYTES - 1,
	).catch(() => undefined)
	if (head === undefined || head.length === 0) return false
	return sniffContainerFormat(head) === "zip"
}

/**
 * List the entries of `archivePath` (zip/tar/7z/rar/xz/gzip). Rejects
 * when the archive is encrypted (7-Zip would prompt for a password on a
 * TTY). Listing output is forced to UTF-8 (`-sccUTF-8`); legacy zip
 * names decode as cp437 byte-wise (see {@link decodeLegacyZipName}).
 */
export async function listSevenZipEntries(
	archivePath: string,
	opts: SevenZipRunOptions = {},
): Promise<SevenZipEntry[]> {
	const bin = resolveSevenZipPath()
	if (bin === undefined) throw sevenZipUnavailable()
	const args = ["l", "-slt", "-ba", "-sccUTF-8"]
	const legacyNames = await isZipArchive(archivePath)
	args.push(archivePath)
	const { stdout } = await run7z(bin, args, opts.timeoutMs ?? 120_000)
	return parseSltListing(stdout, legacyNames)
}

/**
 * Extract `archivePath` in full into `destDir`. Callers must pre-validate
 * budgets from {@link listSevenZipEntries} — 7-Zip has no byte-level
 * progress or per-entry abort, so the listing is the enforcement point.
 * Legacy zip names land on disk as 7-Zip wrote them (raw bytes on POSIX);
 * callers fix them up afterwards via `normalizeExtractedTree` (extract.ts).
 */
export async function extractSevenZipInto(
	archivePath: string,
	destDir: string,
	opts: SevenZipRunOptions = {},
): Promise<void> {
	const bin = resolveSevenZipPath()
	if (bin === undefined) throw sevenZipUnavailable()
	const args = ["x", archivePath, `-o${destDir}`, "-y", "-bd"]
	await run7z(bin, args, opts.timeoutMs ?? 10 * 60_000)
}
