import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
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
import { normalizeZipError } from "./zip-entries.ts"

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
		// both up before the tree is re-walked or probed below.
		await normalizeExtractedTree(root, { legacyZipNames: format === "zip" })
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
 * bytes verbatim on POSIX); every entry gets owner permissions OR'd in
 * so the app can always read, serve and clean up what it extracted
 * (zip/tar entries can carry mode bits that strip owner access). Never
 * follows symlinks — refusal stays with {@link assertExtractedTree}.
 * Windows is unaffected: names are already decoded and mode bits are
 * ignored there.
 */
export async function normalizeExtractedTree(
	root: string,
	opts: { readonly legacyZipNames: boolean },
): Promise<void> {
	if (opts.legacyZipNames) {
		await renameLegacyZipNames(Buffer.from(root), root)
	}
	await makeReadable(root)
}

/**
 * Rename every entry bottom-up whose raw name bytes are not valid UTF-8
 * to their cp437-decoded form. 7-Zip on POSIX writes legacy zip names
 * verbatim, so the decoded name is what the rest of the pipeline
 * (listing, manifest, browser paths) expects. Children are renamed
 * before their parents so a raw-named directory never orphans the
 * descendant paths it holds.
 */
async function renameLegacyZipNames(
	rawRoot: Buffer,
	decodedRoot: string,
): Promise<void> {
	const entries = await readdir(rawRoot, {
		withFileTypes: true,
		encoding: "buffer",
	})
	for (const entry of entries) {
		const childRaw = Buffer.concat([rawRoot, Buffer.from(sep), entry.name])
		const decoded = decodeLegacyZipName(entry.name)
		if (entry.isDirectory()) {
			await renameLegacyZipNames(childRaw, `${decodedRoot}/${decoded}`)
		}
		if (decoded !== entry.name.toString("utf8")) {
			await rename(childRaw, `${decodedRoot}/${decoded}`)
		}
	}
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
