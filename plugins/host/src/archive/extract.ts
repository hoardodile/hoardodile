import { randomUUID } from "node:crypto"
import { createWriteStream, existsSync } from "node:fs"
import {
	chmod,
	lstat,
	mkdir,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, normalize, resolve, sep } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import yauzl, { type Entry, type ZipFile } from "yauzl"
import { invalid } from "../errors.ts"
import {
	extractSevenZipInto,
	listSevenZipEntries,
	resolveSevenZipPath,
} from "./7z.ts"
import {
	type ContainerFormat,
	SNIFF_WINDOW_BYTES,
	sniffContainerFormat,
} from "./format.ts"
import { listingBudgetExceeded } from "./listing.ts"
import { decodeLegacyZipName } from "./name-decode.ts"
import { listZipEntries, normalizeZipError } from "./zip-entries.ts"

/**
 * Whole-archive extraction. Every supported format (zip, tar, 7z, rar,
 * xz, gzip) extracts through 7-Zip with listing-validated budgets; when
 * the optional 7-Zip binary is absent, zip falls back to a yauzl
 * streaming path with a per-byte budget counter. Used by plugin
 * installation, folder-import extraction and the plugin extract API —
 * the workflows that need a directory layout.
 */

/**
 * Extraction progress reporter for {@link extractArchiveInto}. The
 * 7-Zip path reports the two phases only (listing pre-check, done);
 * the yauzl fallback reports per-entry events.
 */
export type ZipExtractReporter = (event: ZipExtractReport) => void

export type ZipExtractReport =
	| {
			readonly phase: "started"
			readonly totalEntries: number
			readonly totalBytes: number
	  }
	| {
			readonly phase: "entry"
			readonly entriesDone: number
			readonly totalEntries: number
			readonly bytesDone: number
			readonly totalBytes: number
	  }
	| { readonly phase: "done" }

export type ExtractArchiveOptions = {
	/** Cumulative uncompressed byte budget for the whole archive. */
	readonly maxBytes: number
	/** Optional entry-count budget (enforced on the listing). */
	readonly maxEntries?: number
	readonly onProgress?: ZipExtractReporter
}

/**
 * Stream an archive into `destDir`, format-agnostic: every supported
 * format (zip/tar/7z/rar/xz/gzip) extracts through 7-Zip after
 * validating budgets, encryption and paths from its listing, then
 * re-verifies the extracted tree (size + symlink scan). Without a
 * 7-Zip binary, zip extracts through yauzl with a per-byte budget
 * counter; the other formats error with "7-Zip is not installed".
 * Used by plugin installation and folder-import extraction (the
 * workflows that need a directory layout).
 *
 * Refuses any entry whose normalised path escapes `destDir` (zip-slip)
 * or contains an absolute path / drive letter. Defends against zip
 * bombs via `maxBytes` (and `maxEntries` when provided).
 *
 * @throws DomainError VALIDATION when the archive is malformed,
 *   contains an unsafe entry, exceeds the budgets, is encrypted, or is
 *   not a supported archive at all.
 */
export async function extractArchiveInto(
	source: NodeJS.ReadableStream,
	destDir: string,
	opts: ExtractArchiveOptions,
): Promise<void> {
	const buffer = await readToBuffer(source)
	const format = sniffContainerFormat(buffer.subarray(0, SNIFF_WINDOW_BYTES))
	if (format === undefined) {
		throw invalid(
			"resource.archive_open_failed",
			"not a supported archive (zip/tar/7z/rar/xz/gzip)",
			{},
		)
	}
	if (format === "zip" && resolveSevenZipPath() === undefined) {
		return extractZipBuffer(buffer, destDir, opts)
	}
	return extractViaSevenZip(buffer, destDir, opts, format)
}

/**
 * Zip branch when 7-Zip is absent: yauzl streaming with per-byte budget
 * and entry progress. Kept so zip imports work on installs where the
 * optional binary failed to download.
 */
async function extractZipBuffer(
	buffer: Buffer,
	destDir: string,
	opts: ExtractArchiveOptions,
): Promise<void> {
	const { maxBytes, maxEntries, onProgress } = opts
	const zipfile = await openZipFromBuffer(buffer)
	if (maxEntries !== undefined && zipfile.entryCount > maxEntries) {
		zipfile.close()
		throw invalid(
			"resource.archive_too_large",
			`archive has ${zipfile.entryCount} entries, exceeding the limit of ${maxEntries}`,
			{ maxEntries },
		)
	}
	const root = resolve(destDir)
	const budget = { remaining: maxBytes, max: maxBytes }
	const totalEntries = zipfile.entryCount
	const counters = { entriesDone: 0, bytesDone: 0, totalBytes: 0 }
	if (onProgress !== undefined) {
		onProgress({ phase: "started", totalEntries, totalBytes: 0 })
	}
	try {
		await new Promise<void>((resolveDone, rejectDone) => {
			zipfile.on("error", (err: unknown) => rejectDone(normalizeZipError(err)))
			zipfile.on("end", resolveDone)
			zipfile.on("entry", (entry: Entry) => {
				handleExtractEntry(zipfile, entry, root, budget).then(() => {
					counters.entriesDone += 1
					counters.bytesDone += entry.uncompressedSize
					counters.totalBytes += entry.uncompressedSize
					if (onProgress !== undefined) {
						onProgress({
							phase: "entry",
							entriesDone: counters.entriesDone,
							totalEntries,
							bytesDone: counters.bytesDone,
							totalBytes: counters.totalBytes,
						})
					}
					zipfile.readEntry()
				}, rejectDone)
			})
			zipfile.readEntry()
		})
	} finally {
		zipfile.close()
	}
	if (onProgress !== undefined) {
		onProgress({ phase: "done" })
	}
}

/**
 * 7-Zip branch for every supported format: write the bytes to a temp
 * file (7-Zip needs a real path), validate budgets, encryption and
 * entry paths from the listing, extract in one pass, then verify the
 * extracted tree (size re-check + symlink refusal).
 */
async function extractViaSevenZip(
	buffer: Buffer,
	destDir: string,
	opts: ExtractArchiveOptions,
	format: ContainerFormat,
): Promise<void> {
	const { maxBytes, maxEntries, onProgress } = opts
	const tempPath = join(
		tmpdir(),
		`hoardodile-7z-${process.pid}-${randomUUID().slice(0, 8)}`,
	)
	await writeFile(tempPath, buffer)
	try {
		const entries = await listSevenZipEntries(tempPath)
		const files = entries.filter((e) => !e.folder)
		const exceeded = listingBudgetExceeded(files, { maxBytes, maxEntries })
		if (exceeded?.kind === "bytes") {
			throw invalid(
				"resource.archive_too_large",
				`archive extracts to more than ${maxBytes} bytes`,
				{ maxExtractedBytes: maxBytes },
			)
		}
		if (exceeded?.kind === "entries") {
			throw invalid(
				"resource.archive_too_large",
				`archive has ${files.length} entries, exceeding the limit of ${maxEntries}`,
				{ maxEntries },
			)
		}
		if (entries.some((e) => e.encrypted)) {
			throw invalid(
				"resource.archive_invalid_entry",
				"archive is password-protected — encrypted archives are not supported",
				{},
			)
		}
		for (const entry of files) assertSafeEntryPath(entry.name)
		const root = resolve(destDir)
		await mkdir(root, { recursive: true })
		const totalBytes = files.reduce((acc, e) => acc + e.sizeBytes, 0)
		onProgress?.({ phase: "started", totalEntries: files.length, totalBytes })
		await extractSevenZipInto(tempPath, root)
		// 7-Zip writes legacy zip names verbatim on POSIX and restores
		// entries' mode bits, which can strip the app's own access; fix
		// both up before the tree is re-walked or probed below. The
		// decoded names of the archive itself are the ground truth the
		// legacy-rename pass matches against (see `renameLegacyZipNames`)
		// — 7-Zip's text listing loses the invalid bytes on POSIX.
		const decoded =
			format === "zip"
				? await decodeZipNames(
						tempPath,
						files.map((e) => ({ name: e.name, sizeBytes: e.sizeBytes })),
					)
				: undefined
		await normalizeExtractedTree(root, {
			legacyZipNames: format === "zip",
			expectedNames: decoded?.paths,
		})
		// Post-hoc bomb re-check: the listing sizes are advisory; count
		// what actually landed (and refuse symlinks — 7-Zip creates them
		// from zip/tar entries carrying unix link modes).
		await assertExtractedTree(root, maxBytes)
		onProgress?.({ phase: "done" })
	} finally {
		await rm(tempPath, { force: true }).catch(() => {})
	}
}

/**
 * Walk an extracted tree verifying that every entry is a regular file
 * or directory (symlinks and special files are refused outright — a
 * malicious archive could otherwise plant a link out of the extraction
 * root) and that the total size stays within `maxBytes`.
 */
export async function assertExtractedTree(
	root: string,
	maxBytes: number,
): Promise<void> {
	let total = 0
	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const full = join(dir, entry.name)
			// lstat, not dirent: on Windows, junction points (reparse
			// tags) are only reported as links by lstat.
			const info = await lstat(full)
			if (info.isSymbolicLink()) {
				throw invalid(
					"resource.archive_invalid_entry",
					`extracted entry is a symlink: ${entry.name}`,
					{ name: entry.name },
				)
			}
			if (info.isDirectory()) {
				await walk(full)
				continue
			}
			if (!info.isFile()) {
				throw invalid(
					"resource.archive_invalid_entry",
					`extracted entry is not a regular file: ${entry.name}`,
					{ name: entry.name },
				)
			}
			total += info.size
			if (total > maxBytes) {
				throw invalid(
					"resource.archive_too_large",
					`archive extracts to more than ${maxBytes} bytes`,
					{ maxExtractedBytes: maxBytes },
				)
			}
		}
	}
	await walk(root)
}

/**
 * Post-extraction hygiene for a 7-Zip materialized tree, run before the
 * tree is re-walked by {@link assertExtractedTree} or probed for the
 * manifest. For zip archives, entries whose on-disk names are not valid
 * UTF-8 are renamed to their cp437-decoded form (7-Zip writes the raw
 * bytes verbatim on POSIX, and macOS stores those bytes `%XX`-escaped —
 * see {@link renameLegacyZipNames} for both shapes); every entry gets
 * owner permissions OR'd in so the app can always read, serve and clean
 * up what it extracted (zip/tar entries can carry mode bits that strip
 * owner access). Never follows symlinks — refusal stays with
 * {@link assertExtractedTree}. Windows is unaffected: names are already
 * decoded and mode bits are ignored there.
 */
export async function normalizeExtractedTree(
	root: string,
	opts: {
		readonly legacyZipNames: boolean
		/**
		 * Decoded listing names (forward-slash, relative) of the archive
		 * being extracted. The disambiguator for the macOS `%XX`-escaped
		 * name shape: an escaped name is valid UTF-8, so validity alone
		 * cannot tell `caf%82.jpg` (a legacy cp437 `café.jpg` after
		 * macOS escaping) apart from a file literally named
		 * `report%82.jpg` — only the listing's decoded name settles it.
		 */
		readonly expectedNames?: readonly string[]
	},
): Promise<void> {
	if (opts.legacyZipNames) {
		const expected = opts.expectedNames
			? new Set(opts.expectedNames.map((n) => n.replace(/\/+$/, "")))
			: undefined
		await renameLegacyZipNames(Buffer.from(root), root, root, expected)
	}
	await makeReadable(root)
}

/**
 * Decoded names of a zip archive — the ground truth for legacy (cp437)
 * entry names. 7-Zip's text listing drops the bytes that are not valid
 * UTF-8 in the archive: its console conversion removes the escape points
 * on POSIX, so the reported name loses the character entirely. The zip
 * itself is authoritative, so names come from yauzl (`decodeStrings`
 * decodes non-UTF-8 names as cp437). Directory entries are absent from
 * that listing, so every ancestor directory of a file path is added to
 * `paths` for the rename pass. Falls back to the 7-Zip-listing names when
 * the zip cannot be parsed a second time — extraction then proceeds
 * exactly as before.
 */
export async function decodeZipNames(
	zipPath: string,
	fallback: readonly { readonly name: string; readonly sizeBytes: number }[],
): Promise<{
	readonly files: readonly {
		readonly name: string
		readonly sizeBytes: number
	}[]
	readonly paths: readonly string[]
}> {
	try {
		const records = await listZipEntries(zipPath, { dataOffsets: false })
		const files = records.map((e) => ({
			name: e.name,
			sizeBytes: e.uncompressedSize,
		}))
		const paths = new Set<string>()
		for (const file of files) {
			const segments = file.name.split("/")
			for (let i = 1; i < segments.length; i++) {
				paths.add(segments.slice(0, i).join("/"))
			}
			paths.add(file.name)
		}
		return { files, paths: [...paths] }
	} catch {
		return { files: fallback, paths: fallback.map((e) => e.name) }
	}
}

/**
 * Rename every entry whose name does not match its decoded listing
 * form. Legacy zip names can land on disk in two shapes:
 *
 *  - raw bytes, when the archive name is not valid UTF-8 (7-Zip's POSIX
 *    and Windows builds pass/write them verbatim);
 *  - `%XX`-escaped bytes, when macOS's UTF-8 filesystem layer stores the
 *    raw names from the first shape (`XNU`'s `vfs_utfconv.c` converts an
 *    illegal byte to `%` + two hex digits while normalizing);
 *  - 7-Zip escape-plane characters (U+EF00+byte), the round-trip form
 *    for an illegal byte written without the byte-level conversion.
 *
 * The last two are valid UTF-8 on disk and are reconciled against the
 * decoded names of the archive itself (see {@link decodeZipNames}) — the
 * only lossless source, since 7-Zip's text listing drops those bytes on
 * POSIX. A rename never clobbers an existing entry, and either escaped
 * shape only wins when the recovered name matches a decoded listing path
 * at the same position — a file genuinely named `report%82.jpg` (or with
 * a private-use character) therefore stays untouched.
 */
async function renameLegacyZipNames(
	rawRoot: Buffer,
	decodedRoot: string,
	root: string,
	expected: ReadonlySet<string> | undefined,
): Promise<void> {
	const entries = await readdir(rawRoot, {
		withFileTypes: true,
		encoding: "buffer",
	})
	for (const entry of entries) {
		const childRaw = Buffer.concat([rawRoot, Buffer.from(sep), entry.name])
		const decoded = decodeLegacyZipName(entry.name)
		const target = legacyRenameTarget(
			entry.name,
			decoded,
			decodedRoot,
			root,
			expected,
		)
		if (entry.isDirectory()) {
			if (target !== undefined && !existsSync(target)) {
				await rename(childRaw, target)
				await renameLegacyZipNames(Buffer.from(target), target, root, expected)
				continue
			}
			// Either no rename applies, or the decoded target already
			// exists (a real entry owns the decoded name) — the raw
			// directory itself stays, but its descendants must still be
			// renamed under the decoded prefix.
			await renameLegacyZipNames(
				childRaw,
				target ?? `${decodedRoot}/${decoded}`,
				root,
				expected,
			)
			continue
		}
		if (target === undefined || existsSync(target)) continue
		await rename(childRaw, target)
	}
}

/**
 * The decoded path an extracted entry should be renamed to, or
 * `undefined` when the on-disk name already satisfies the decoded
 * convention (or cannot be decided safely).
 */
function legacyRenameTarget(
	rawName: Buffer,
	decoded: string,
	decodedRoot: string,
	root: string,
	expected: ReadonlySet<string> | undefined,
): string | undefined {
	const utf8Name = rawName.toString("utf8")
	if (decoded !== utf8Name) {
		// Raw bytes are not valid UTF-8: 7-Zip wrote the legacy name
		// verbatim and the fs layer stored it byte-for-byte (Linux,
		// Windows). Decode as cp437, matching the listing.
		return `${decodedRoot}/${decoded}`
	}
	// The name IS valid UTF-8 — but the raw legacy bytes may have been
	// re-encoded on the way to disk (macOS `%XX` escapes, or 7-Zip's
	// escape-plane characters U+EF00+byte). Recover the original bytes and
	// re-decode; only the listing's blessing keeps a literal
	// `report%82.jpg` from being renamed to `reporté.jpg`.
	const raw = recoverRawLegacyName(rawName)
	if (raw === undefined) return undefined
	const recovered = decodeLegacyZipName(raw)
	if (recovered === utf8Name || expected === undefined) return undefined
	const rel =
		decodedRoot === root
			? recovered
			: `${decodedRoot.slice(root.length + 1)}/${recovered}`
	return expected.has(rel) ? `${decodedRoot}/${recovered}` : undefined
}

/**
 * The original archive bytes of an on-disk name that carried a legacy
 * cp437 byte, and `undefined` when the name has no mangle at all. Two
 * transient shapes exist for a raw byte `b`:
 *
 *  - `%XX` hex escapes: macOS's UTF-8 filesystem layer stores illegal
 *    filename bytes that way (`XNU`'s `vfs_utfconv.c`);
 *  - the escape-plane character U+EF00+b: 7-Zip's internal representation
 *    for a byte it cannot show as UTF-8, written verbatim when the name
 *    is encoded without the byte-level round-trip.
 *
 * Either shape maps back to exactly one byte per source byte.
 */
function recoverRawLegacyName(name: Buffer): Buffer | undefined {
	const escaped = unescapePercentEscapes(name)
	if (escaped !== undefined) return escaped
	const text = name.toString("utf8")
	const out: number[] = []
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0
		if (code >= 0xef80 && code <= 0xefff) {
			out.push(code - 0xef00)
			continue
		}
		if (code > 0x7f) return undefined // mixed with real text — not a mangle
		out.push(code)
	}
	return out.length === text.length ? Buffer.from(out) : undefined
}

/**
 * Expand the `%XX` sequences a macOS UTF-8 filesystem writes for illegal
 * filename bytes back to their original byte values. Returns `undefined`
 * when the name contains no `%XX` sequence (nothing to recover). Only
 * sequences whose bytes are illegal as UTF-8 matter to the caller —
 * legitimate `%XX` substrings simply survive as decoded characters and
 * fail the listing match.
 */
function unescapePercentEscapes(name: Buffer): Buffer | undefined {
	const text = name.toString("latin1")
	if (!text.includes("%")) return undefined
	const out: number[] = []
	let changed = false
	for (let i = 0; i < text.length; i++) {
		const hex = i + 2 < text.length ? text.slice(i + 1, i + 3) : undefined
		if (text[i] === "%" && hex !== undefined && /^[0-9a-fA-F]{2}$/.test(hex)) {
			out.push(Number.parseInt(hex, 16))
			changed = true
			i += 2
			continue
		}
		out.push(text.charCodeAt(i))
	}
	return changed ? Buffer.from(out) : undefined
}

/**
 * OR owner permissions into every entry (directories rwx, files rw) so
 * extracted archives stay accessible to the app whatever mode bits the
 * entries carried. Symlinks and special files are skipped — they are
 * refused by {@link assertExtractedTree} afterwards and must never be
 * followed here.
 */
async function makeReadable(root: string): Promise<void> {
	const entries = await readdir(root, { withFileTypes: true })
	for (const entry of entries) {
		const full = join(root, entry.name)
		if (entry.isDirectory()) {
			await chmod(full, (await lstat(full)).mode | 0o700)
			await makeReadable(full)
			continue
		}
		if (entry.isFile()) {
			await chmod(full, (await lstat(full)).mode | 0o600)
		}
	}
}

/** Reject absolute paths and traversal segments (zip-slip guard). */
function assertSafeEntryPath(rawName: string): void {
	if (
		rawName.length === 0 ||
		/^([a-zA-Z]:)?[\\/]/.test(rawName) ||
		rawName.split("/").includes("..")
	) {
		throw invalid(
			"resource.archive_invalid_entry",
			`archive entry has an unsafe path: ${rawName}`,
			{ rawName },
		)
	}
}

async function handleExtractEntry(
	zipfile: ZipFile,
	entry: Entry,
	root: string,
	budget: { remaining: number; readonly max: number },
): Promise<void> {
	const safe = safeExtractEntryPath(entry.fileName, root)
	if (entry.fileName.endsWith("/")) {
		await mkdir(safe, { recursive: true })
		return
	}
	await mkdir(dirname(safe), { recursive: true })
	const stream = await openZipEntryStream(zipfile, entry)
	await pipeline(stream, makeByteBudgetCounter(budget), createWriteStream(safe))
}

function safeExtractEntryPath(rawName: string, root: string): string {
	if (rawName.length === 0) {
		throw invalid(
			"resource.archive_invalid_entry",
			"archive entry has empty name",
			{ rawName },
		)
	}
	if (/^([a-zA-Z]:)?[\\/]/.test(rawName)) {
		throw invalid(
			"resource.archive_invalid_entry",
			`archive entry has absolute path: ${rawName}`,
			{ rawName },
		)
	}
	const normalised = normalize(rawName).replace(/\\/g, "/")
	if (normalised.startsWith("../") || normalised === "..") {
		throw invalid(
			"resource.archive_invalid_entry",
			`archive entry escapes destination: ${rawName}`,
			{ rawName },
		)
	}
	const candidate = resolve(root, normalised)
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		throw invalid(
			"resource.archive_invalid_entry",
			`archive entry escapes destination: ${rawName}`,
			{ rawName },
		)
	}
	return candidate
}

/**
 * Transform that subtracts each chunk's size from a shared byte budget
 * and destroys itself with a VALIDATION error once the budget would go
 * negative. Used to defend against zip bombs across all entries in a
 * single archive on the yauzl fallback path (the 7-Zip path pre-checks
 * the listing and re-verifies the extracted tree instead).
 */
function makeByteBudgetCounter(budget: {
	remaining: number
	readonly max: number
}): Transform {
	return new Transform({
		transform(chunk, _enc, cb) {
			const len = Buffer.isBuffer(chunk)
				? chunk.length
				: Buffer.byteLength(chunk)
			budget.remaining -= len
			if (budget.remaining < 0) {
				cb(
					invalid(
						"resource.archive_too_large",
						`archive extracts to more than ${budget.max} bytes`,
						{ maxExtractedBytes: budget.max },
					),
				)
				return
			}
			cb(undefined, chunk)
		},
	})
}

async function readToBuffer(source: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = []
	for await (const chunk of source) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
	}
	return Buffer.concat(chunks)
}

function openZipFromBuffer(buffer: Buffer): Promise<ZipFile> {
	return new Promise<ZipFile>((res, rej) => {
		yauzl.fromBuffer(
			buffer,
			{ lazyEntries: true },
			(err: Error | null, zip: ZipFile) => {
				if (err !== null || zip === undefined) {
					rej(
						invalid(
							"resource.archive_open_failed",
							err?.message ?? "could not open archive",
							{},
						),
					)
					return
				}
				res(zip)
			},
		)
	})
}

function openZipEntryStream(
	zipfile: ZipFile,
	entry: Entry,
): Promise<NodeJS.ReadableStream> {
	return new Promise((res, rej) => {
		zipfile.openReadStream(entry, (err, stream) => {
			if ((err !== null && err !== undefined) || stream === undefined) {
				rej(
					invalid(
						"resource.archive_entry_unreadable",
						err?.message ?? `could not read archive entry: ${entry.fileName}`,
						{ entry: entry.fileName },
					),
				)
				return
			}
			res(stream)
		})
	})
}
