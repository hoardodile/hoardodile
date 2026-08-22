#!/usr/bin/env node
/**
 * One-off migration to the current storage layout. For each resource
 * folder under `versions/<v>/resources/<id>/` (and trashed resource
 * folders under `local/trash/resources-<id>-<ts>/`):
 *
 *   1. a folder containing `source.hoard` (legacy STORED zip archive):
 *        - parse the zip's central directory (metadata only — ZIP64 and
 *          non-ZIP64 alike), reject archives whose cumulative uncompressed
 *          size exceeds `--max-bytes`;
 *        - sanitize entry names (rules mirror `plugins/host/src/hoard/sanitize.ts`)
 *          and resolve collisions case-insensitively;
 *        - stream-extract into a sibling temp dir on the same volume
 *          (entries are never buffered whole, so multi-GiB files and
 *          archives past the 4 GiB ZIP64 boundary work); every entry's
 *          bytes are verified against its central-directory CRC-32 and
 *          size, so a corrupt archive fails cleanly instead of extracting
 *          silently damaged files;
 *        - install the entries into the resource's content root
 *          (`data/`), writing an order manifest (`data/.order`) that
 *          preserves the archive's original entry order; root metadata
 *          dotfiles like `.cover.*` stay untouched;
 *        - delete `source.hoard`.
 *
 *   2. a folder whose bare files sit at the resource root (the pre-`data/`
 *        layout): move them into the content root `data/`.
 *
 * Idempotent: folders that are already migrated (no `source.hoard`, no
 * root-level content) are skipped, so the script can be re-run after
 * restoring an old backup.
 *
 * Usage:
 *   node scripts/migrate-hoard-to-files.mjs <storageRoot> [--max-bytes <n>] [--dry-run]
 *
 * Stop the server before running. Keep this script in sync with
 * `plugins/host/src/hoard/sanitize.ts` when changing filename rules.
 */
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { crc32, createInflateRaw } from "node:zlib"

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024 * 1024 // 64 GiB
const SOURCE_ARCHIVE_NAME = "source.hoard"
const CONTENT_DIR_NAME = "data"
const ORDER_MANIFEST_NAME = ".order"
const EOCD_SIG = 0x06054b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const CD_SIG = 0x02014b50
const LH_SIG = 0x04034b50
const EOCD_MIN_SIZE = 22
const EOCD_MAX_COMMENT = 65535
const ZIP64_EOCD_FIXED_SIZE = 56
const ZIP64_LOCATOR_SIZE = 20
const ZIP64_EXTRA_ID = 0x0001
const ZIP64_MARKER_16 = 0xffff
const ZIP64_MARKER_32 = 0xffffffff

// ── Filename sanitization (mirror of plugins/host/src/hoard/sanitize.ts) ──

const FORBIDDEN_VISIBLE_CHARS = '<>:"|?*'
const MAX_SEGMENT_BYTES = 240
const MAX_REL_PATH_CHARS = 700
const WINDOWS_RESERVED = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM0",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT0",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
	"CONIN$",
	"CONOUT$",
	"COM\u00b9",
	"COM\u00b2",
	"COM\u00b3",
	"LPT\u00b9",
	"LPT\u00b2",
	"LPT\u00b3",
])

function truncateUtf8(value, maxBytes) {
	let bytes = 0
	let out = ""
	for (const ch of value) {
		const len = Buffer.byteLength(ch, "utf8")
		if (bytes + len > maxBytes) break
		bytes += len
		out += ch
	}
	return out
}

function cleanSegment(raw) {
	if (raw.length === 0 || raw === "." || raw === "..") return undefined
	let out = ""
	for (const ch of raw) {
		const code = ch.codePointAt(0)
		if (code !== undefined && code < 32) continue
		out += FORBIDDEN_VISIBLE_CHARS.includes(ch) ? "_" : ch
	}
	let trimmed = out.replace(/^\.+/, "").replace(/[. ]+$/, "")
	if (trimmed.length === 0) return undefined
	trimmed = truncateUtf8(trimmed, MAX_SEGMENT_BYTES)
	if (trimmed.length === 0) return undefined
	const base = trimmed.split(".")[0]?.toUpperCase()
	if (base !== undefined && WINDOWS_RESERVED.has(base)) trimmed = `_${trimmed}`
	return trimmed
}

function sanitizeEntryName(name) {
	if (name.length === 0 || name.includes("\0")) return undefined
	const normalized = name.normalize("NFC")
	const segments = []
	for (const raw of normalized.replace(/\\/g, "/").split("/")) {
		const cleaned = cleanSegment(raw)
		if (cleaned !== undefined) segments.push(cleaned)
	}
	if (segments.length === 0) return undefined
	const relPath = segments.join("/")
	if (relPath.length > MAX_REL_PATH_CHARS) return undefined
	return relPath
}

function createOccupiedNames(existing) {
	return {
		files: new Set(existing?.files ?? []),
		dirs: new Set(existing?.dirs ?? []),
	}
}

function occupyEntryName(occupied, relPath) {
	occupied.files.add(relPath)
	let prefix = ""
	for (const segment of relPath.split("/").slice(0, -1)) {
		prefix = prefix.length > 0 ? `${prefix}/${segment}` : segment
		occupied.dirs.add(prefix)
	}
}

function collidingSegment(lowerFiles, lowerDirs, candidate) {
	const segments = candidate.split("/")
	const lower = candidate.toLowerCase()
	if (lowerFiles.has(lower) || lowerDirs.has(lower)) return segments.length - 1
	let prefix = ""
	for (let i = 0; i < segments.length - 1; i += 1) {
		prefix = prefix.length > 0 ? `${prefix}/${segments[i]}` : segments[i]
		if (lowerFiles.has(prefix.toLowerCase())) return i
	}
	return -1
}

function uniqueEntryName(occupied, relPath) {
	const lowerFiles = new Set([...occupied.files].map((p) => p.toLowerCase()))
	const lowerDirs = new Set([...occupied.dirs].map((p) => p.toLowerCase()))
	let candidate = relPath
	for (let guard = 0; guard < 10000; guard += 1) {
		const segIdx = collidingSegment(lowerFiles, lowerDirs, candidate)
		if (segIdx < 0) return candidate
		const segments = candidate.split("/")
		const target = segments[segIdx]
		const dot = target.lastIndexOf(".")
		const stem = dot > 0 ? target.slice(0, dot) : target
		const ext = dot > 0 ? target.slice(dot) : ""
		for (let i = 1; ; i += 1) {
			const next = `${stem}-${i}${ext}`
			const rebuilt = segments
				.map((seg, idx) => (idx === segIdx ? next : seg))
				.join("/")
			if (collidingSegment(lowerFiles, lowerDirs, rebuilt) < 0) {
				candidate = rebuilt
				break
			}
		}
	}
	throw new Error(`unable to resolve a unique name for ${relPath}`)
}

// ── Minimal zip reader (STORED + DEFLATE, ZIP64) ──────────────────────────
//
// All archive reads go through `createReadStream` byte ranges. `fs.read`
// positions beyond 2 GiB hit a native Int32 assertion on some Node
// builds, while read streams accept 64-bit offsets — ZIP64 central
// directories can sit far past that boundary.

async function readRange(path, start, end) {
	const length = end - start
	if (length <= 0) return Buffer.alloc(0)
	const chunks = []
	let total = 0
	const stream = createReadStream(path, { start, end: end - 1 })
	for await (const chunk of stream) {
		chunks.push(chunk)
		total += chunk.length
	}
	if (total !== length) throw new Error("unexpected end of zip")
	return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
}

async function findEocd(path, size) {
	const window = Math.min(size, EOCD_MAX_COMMENT + EOCD_MIN_SIZE)
	const tail = await readRange(path, size - window, size)
	for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
		if (tail.readUInt32LE(i) !== EOCD_SIG) continue
		const entryCount = tail.readUInt16LE(i + 10)
		const cdSize = tail.readUInt32LE(i + 12)
		const cdOffset = tail.readUInt32LE(i + 16)
		if (
			entryCount !== ZIP64_MARKER_16 &&
			cdSize !== ZIP64_MARKER_32 &&
			cdOffset !== ZIP64_MARKER_32
		) {
			return { cdOffset, cdSize, entryCount }
		}
		// ZIP64: the locator sits directly before the classic EOCD and
		// points at the real end-of-central-directory record.
		if (i < ZIP64_LOCATOR_SIZE) {
			throw new Error("zip64 end-of-central-directory locator not found")
		}
		const locator = await readRange(path, i - ZIP64_LOCATOR_SIZE, i)
		if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) {
			throw new Error("zip64 end-of-central-directory locator not found")
		}
		const zip64Offset = Number(locator.readBigUInt64LE(8))
		const head = await readRange(
			path,
			zip64Offset,
			zip64Offset + ZIP64_EOCD_FIXED_SIZE,
		)
		if (head.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
			throw new Error("zip64 end-of-central-directory record not found")
		}
		return {
			cdOffset: Number(head.readBigUInt64LE(48)),
			cdSize: Number(head.readBigUInt64LE(40)),
			entryCount: Number(head.readBigUInt64LE(32)),
		}
	}
	throw new Error("end-of-central-directory not found")
}

/**
 * Replace `0xffffffff` size/offset markers with the 64-bit values from the
 * entry's ZIP64 extended-information extra field (0x0001). Values appear
 * in spec order and only for the fields whose 32-bit slot overflowed.
 */
function readZip64Extra(extra, sizes) {
	let p = 0
	while (p + 4 <= extra.length) {
		const id = extra.readUInt16LE(p)
		const len = extra.readUInt16LE(p + 2)
		const data = extra.subarray(p + 4, p + 4 + len)
		if (id === ZIP64_EXTRA_ID) {
			let q = 0
			const next = () => {
				const value = Number(data.readBigUInt64LE(q))
				q += 8
				return value
			}
			if (sizes.uncompressed === ZIP64_MARKER_32) sizes.uncompressed = next()
			if (sizes.compressed === ZIP64_MARKER_32) sizes.compressed = next()
			if (sizes.localOffset === ZIP64_MARKER_32) sizes.localOffset = next()
			return
		}
		p += 4 + len
	}
	throw new Error("zip64 extra field not found for a zip64 entry")
}

/** Parse the central directory into entry records with data offsets. */
async function parseCentralDirectory(path, size) {
	const eocd = await findEocd(path, size)
	if (eocd.cdOffset + eocd.cdSize > size) {
		throw new Error("central directory is out of bounds")
	}
	const records = []
	let pos = eocd.cdOffset
	const cdEnd = eocd.cdOffset + eocd.cdSize
	while (pos + 46 <= cdEnd) {
		const head = await readRange(path, pos, pos + 46)
		if (head.readUInt32LE(0) !== CD_SIG) {
			throw new Error("corrupt central directory record")
		}
		const method = head.readUInt16LE(10)
		const sizes = {
			uncompressed: head.readUInt32LE(24),
			compressed: head.readUInt32LE(20),
			localOffset: head.readUInt32LE(42),
		}
		const nameLen = head.readUInt16LE(28)
		const extraLen = head.readUInt16LE(30)
		const commentLen = head.readUInt16LE(32)
		const name = (await readRange(path, pos + 46, pos + 46 + nameLen)).toString(
			"utf8",
		)
		if (
			sizes.uncompressed === ZIP64_MARKER_32 ||
			sizes.compressed === ZIP64_MARKER_32 ||
			sizes.localOffset === ZIP64_MARKER_32
		) {
			const extra = await readRange(
				path,
				pos + 46 + nameLen,
				pos + 46 + nameLen + extraLen,
			)
			readZip64Extra(extra, sizes)
		}

		const localHead = await readRange(
			path,
			sizes.localOffset,
			sizes.localOffset + 30,
		)
		if (localHead.readUInt32LE(0) !== LH_SIG) {
			throw new Error(`corrupt local header for ${name}`)
		}
		const localNameLen = localHead.readUInt16LE(26)
		const localExtraLen = localHead.readUInt16LE(28)
		const dataOffset = sizes.localOffset + 30 + localNameLen + localExtraLen

		if (!name.endsWith("/")) {
			records.push({
				name,
				method,
				compressedSize: sizes.compressed,
				uncompressedSize: sizes.uncompressed,
				crc32: head.readUInt32LE(16),
				dataOffset,
			})
		}
		pos += 46 + nameLen + extraLen + commentLen
	}
	return records
}

// ── Migration ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
	const root = argv[0]
	if (root === undefined) {
		console.error(
			"usage: node scripts/migrate-hoard-to-files.mjs <storageRoot> [--max-bytes <n>] [--dry-run]",
		)
		process.exit(2)
	}
	let maxBytes = DEFAULT_MAX_BYTES
	let dryRun = false
	for (let i = 1; i < argv.length; i += 1) {
		if (argv[i] === "--max-bytes") {
			maxBytes = Number(argv[i + 1])
			if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
				console.error("--max-bytes must be a positive integer")
				process.exit(2)
			}
			i += 1
		} else if (argv[i] === "--dry-run") {
			dryRun = true
		} else {
			console.error(`unknown argument: ${argv[i]}`)
			process.exit(2)
		}
	}
	return { root, maxBytes, dryRun }
}

async function collectResourceDirs(root) {
	const out = []
	const versionsDir = join(root, "versions")
	const versions = await readdir(versionsDir).catch(() => [])
	for (const v of versions) {
		const resourcesDir = join(versionsDir, v, "resources")
		const ids = await readdir(resourcesDir).catch(() => [])
		for (const id of ids) {
			out.push(join(resourcesDir, id))
		}
	}
	const trashDir = join(root, "local", "trash")
	const trashItems = await readdir(trashDir).catch(() => [])
	for (const item of trashItems) {
		if (item.startsWith("resources-")) {
			out.push(join(trashDir, item))
		}
	}
	return out.sort()
}

/** Walk `dir`, yielding files shallow-first with `/`-joined rel paths. */
async function collectFiles(dir) {
	const out = []
	async function walk(here, prefix) {
		const entries = await readdir(here, { withFileTypes: true })
		for (const entry of entries) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) {
				await walk(join(here, entry.name), rel)
			} else if (entry.isFile()) {
				out.push({ rel, abs: join(here, entry.name) })
			}
		}
	}
	await walk(dir, "")
	out.sort((a, b) => {
		const depthA = a.rel.split("/").length
		const depthB = b.rel.split("/").length
		return depthA - depthB || a.rel.localeCompare(b.rel)
	})
	return out
}

async function hasArchive(dir) {
	try {
		const info = await stat(join(dir, SOURCE_ARCHIVE_NAME))
		return info.isFile()
	} catch {
		return false
	}
}

/** Content root of a resource folder. */
function contentDir(dir) {
	return join(dir, CONTENT_DIR_NAME)
}

/**
 * True when the resource root still holds pre-`data/` layout content:
 * any non-dotfile entry that is not the content root directory itself
 * (a legacy bare file, or a user directory that should land inside
 * `data/`). Root dotfiles (`.cover.*`, `.deleted`) are metadata, never
 * content. A root FILE named `data` is legacy content — only the
 * directory `data/` is the content root.
 */
async function hasLegacyContent(dir) {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
	return entries.some(
		(e) =>
			!e.name.startsWith(".") &&
			!(e.isDirectory() && e.name === CONTENT_DIR_NAME),
	)
}

/** Root entries that still need to move into `data/`, by name. */
async function legacyRootEntries(dir) {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
	return entries
		.filter(
			(e) =>
				!e.name.startsWith(".") &&
				!(e.isDirectory() && e.name === CONTENT_DIR_NAME),
		)
		.map((e) => e.name)
		.sort()
}

/**
 * Extract `source.hoard` entries into `tempDir`, resolving final names
 * in central-directory order (so the order manifest preserves the
 * archive's original sequence). Returns the final names in CD order.
 */
async function extractArchive(archivePath, tempDir, maxBytes) {
	const { size } = await stat(archivePath)
	const records = await parseCentralDirectory(archivePath, size)
	let total = 0
	for (const record of records) {
		total += record.uncompressedSize
		if (total > maxBytes) {
			throw new Error(
				`cumulative uncompressed size ${total} exceeds --max-bytes ${maxBytes}`,
			)
		}
	}
	const occupied = createOccupiedNames()
	const finalNames = []
	for (const record of records) {
		const relPath = sanitizeEntryName(record.name)
		if (relPath === undefined) continue
		const name = uniqueEntryName(occupied, relPath)
		occupyEntryName(occupied, name)
		finalNames.push(name)
		await extractEntryData(archivePath, record, join(tempDir, name))
	}
	return finalNames
}

/**
 * Stream one entry's uncompressed bytes into `dest`, verifying both the
 * byte count and the CRC-32 recorded in the central directory. A corrupt
 * archive fails here — the caller discards the temp dir and keeps
 * `source.hoard` untouched.
 */
async function extractEntryData(archivePath, record, dest) {
	await mkdir(dirname(dest), { recursive: true })
	if (record.compressedSize === 0) {
		if (record.uncompressedSize !== 0) {
			throw new Error(
				`size mismatch for ${record.name}: expected ${record.uncompressedSize}, got 0`,
			)
		}
		if (record.crc32 !== 0) {
			throw new Error(`crc mismatch for empty entry ${record.name}`)
		}
		await writeFile(dest, "")
		return
	}
	const source = createReadStream(archivePath, {
		start: record.dataOffset,
		end: record.dataOffset + record.compressedSize - 1,
	})
	let written = 0
	let crc = 0
	const verifier = new Transform({
		transform(chunk, _enc, callback) {
			written += chunk.length
			crc = crc32(chunk, crc)
			callback(null, chunk)
		},
	})
	const sink = createWriteStream(dest)
	if (record.method === 0) {
		await pipeline(source, verifier, sink)
	} else if (record.method === 8) {
		await pipeline(source, createInflateRaw(), verifier, sink)
	} else {
		throw new Error(
			`unsupported compression method ${record.method} for ${record.name}`,
		)
	}
	if (written !== record.uncompressedSize) {
		throw new Error(
			`size mismatch for ${record.name}: expected ${record.uncompressedSize}, got ${written}`,
		)
	}
	if (crc !== record.crc32) {
		throw new Error(
			`crc mismatch for ${record.name}: expected ${record.crc32.toString(16)}, got ${crc.toString(16)}`,
		)
	}
}

/** Move every file of `tempDir` into `content`, suffixing collisions. */
async function mergeTempInto(content, tempDir) {
	const existing = await readdir(content, { withFileTypes: true }).catch(
		() => [],
	)
	const occupied = createOccupiedNames({
		files: existing.filter((e) => e.isFile()).map((e) => e.name),
		dirs: existing.filter((e) => e.isDirectory()).map((e) => e.name),
	})
	const incoming = await collectFiles(tempDir)
	for (const file of incoming) {
		const unique = uniqueEntryName(occupied, file.rel)
		occupyEntryName(occupied, unique)
		const dest = join(content, unique)
		await mkdir(dirname(dest), { recursive: true })
		await rename(file.abs, dest)
	}
}

/** Atomically write the order manifest of a content root. */
async function writeOrderManifest(content, names) {
	const dest = join(content, ORDER_MANIFEST_NAME)
	const tmp = `${dest}.writing-${process.pid}-${Date.now()}`
	try {
		await writeFile(tmp, JSON.stringify(names), "utf8")
		await rename(tmp, dest)
	} catch (err) {
		await rm(tmp, { force: true }).catch(() => {})
		throw err
	}
}

async function migrateArchive(dir, maxBytes, dryRun) {
	const archivePath = join(dir, SOURCE_ARCHIVE_NAME)
	const tempDir = `${dir}.migrate-${Date.now()}`
	try {
		const finalNames = await extractArchive(archivePath, tempDir, maxBytes)
		if (finalNames.length === 0) {
			await rm(tempDir, { recursive: true, force: true })
			throw new Error("archive contains no importable entries")
		}
		if (dryRun) {
			await rm(tempDir, { recursive: true, force: true })
			return { dir, entryCount: finalNames.length, action: "would-migrate" }
		}
		const content = contentDir(dir)
		await mkdir(content, { recursive: true })
		await mergeTempInto(content, tempDir)
		// The manifest records the archive's original entry order, with
		// the final (collision-resolved) names.
		await writeOrderManifest(content, finalNames)
		await rm(tempDir, { recursive: true, force: true })
		await rm(archivePath, { force: true })
		return { dir, entryCount: finalNames.length, action: "migrated" }
	} catch (err) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {})
		return {
			dir,
			action: "error",
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/** Move pre-`data/` root content into the resource's content root. */
async function normalizeLayout(dir, dryRun) {
	const names = await legacyRootEntries(dir)
	if (dryRun) {
		return { dir, entryCount: names.length, action: "would-normalize" }
	}
	const content = contentDir(dir)
	await mkdir(content, { recursive: true })
	const existing = await readdir(content, { withFileTypes: true }).catch(
		() => [],
	)
	const occupied = createOccupiedNames({
		files: existing.filter((e) => e.isFile()).map((e) => e.name),
		dirs: existing.filter((e) => e.isDirectory()).map((e) => e.name),
	})
	for (const name of names) {
		const unique = uniqueEntryName(occupied, name)
		occupyEntryName(occupied, unique)
		await rename(join(dir, name), join(content, unique))
	}
	return { dir, entryCount: names.length, action: "normalized" }
}

async function migrateDir(dir, maxBytes, dryRun) {
	if (await hasArchive(dir)) {
		return migrateArchive(dir, maxBytes, dryRun)
	}
	if (await hasLegacyContent(dir)) {
		return normalizeLayout(dir, dryRun)
	}
	return { dir, entryCount: 0, action: "skipped" }
}

async function main() {
	const { root, maxBytes, dryRun } = parseArgs(process.argv.slice(2))
	const rootInfo = await stat(root).catch(() => undefined)
	if (rootInfo === undefined || !rootInfo.isDirectory()) {
		console.error(`storage root not found: ${root}`)
		process.exit(2)
	}
	console.log(
		`${dryRun ? "[dry-run] " : ""}migrating resources under ${root} (max ${maxBytes} bytes/archive)`,
	)
	const dirs = await collectResourceDirs(root)
	if (dirs.length === 0) {
		console.log("no resource folders found — nothing to do.")
		return
	}
	let migrated = 0
	let normalized = 0
	let errors = 0
	for (const dir of dirs) {
		const result = await migrateDir(dir, maxBytes, dryRun)
		if (result.action === "migrated") {
			migrated += 1
			console.log(`ok        ${result.dir} (${result.entryCount} entries)`)
		} else if (result.action === "would-migrate") {
			console.log(`would     ${result.dir} (${result.entryCount} entries)`)
		} else if (result.action === "normalized") {
			normalized += 1
			console.log(`layout    ${result.dir} (${result.entryCount} entries)`)
		} else if (result.action === "would-normalize") {
			console.log(`would     ${result.dir} (${result.entryCount} entries)`)
		} else if (result.action === "error") {
			errors += 1
			console.error(`FAILED    ${result.dir}: ${result.error}`)
		}
	}
	console.log(
		`done: ${migrated} migrated, ${normalized} normalized, ${dirs.length - migrated - normalized - errors} skipped, ${errors} failed.`,
	)
	if (errors > 0) process.exitCode = 1
}

main().catch((err) => {
	console.error(err)
	process.exitCode = 1
})
