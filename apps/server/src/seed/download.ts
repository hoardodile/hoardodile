/**
 * Resolve and cache Wikimedia Commons files for the demo seed. Licenses
 * are checked against the allowlist on every fetch; oversized originals
 * are skipped. Images prefer a ~1600px thumbnail so PD-Art scans do not
 * pull hundreds of megabytes. Resource entry names are ASCII slugs of
 * the Commons title so spaces in titles do not leak into sandbox paths.
 */

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CommonsMedia, LicenseFamily } from "./catalog.ts"

export const SEED_USER_AGENT =
	"HoardodileDemoSeed/0.0.0 (https://github.com/hoardodile/hoardodile; official demo library seeder)"

const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024
const COMMONS_API = "https://commons.wikimedia.org/w/api.php"
const FETCH_TIMEOUT_MS = 90_000

export type DownloadedFile = {
	readonly title: string
	readonly path: string
	readonly filename: string
	readonly mime: string
	readonly license: string
	readonly pageUrl: string
	readonly bytes: number
}

export type DownloadOptions = {
	readonly cacheDir: string
	readonly skipDownload: boolean
}

type CacheMeta = {
	readonly title: string
	readonly url: string
	readonly pageUrl: string
	readonly mime: string
	readonly license: string
	readonly filename: string
	readonly bytes: number
}

export type ResolveWarning = {
	readonly title: string
	readonly message: string
}

export type ResolveResult = {
	readonly files: ReadonlyMap<string, DownloadedFile>
	readonly warnings: readonly ResolveWarning[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function cacheKey(title: string): string {
	return createHash("sha256").update(title).digest("hex").slice(0, 16)
}

/**
 * Stable resource entry name from a Commons title. Spaces and punctuation
 * in titles like `Van Gogh - Starry Night - Google Art Project.jpg` make
 * brittle sandbox paths and file URLs; a short ASCII slug does not.
 */
export function seedFilename(title: string): string {
	const rest = title.replace(/^File:/i, "").trim()
	const dot = rest.lastIndexOf(".")
	const stem = dot > 0 ? rest.slice(0, dot) : rest
	const ext = dot > 0 ? rest.slice(dot).toLowerCase() : ""
	const slug = slugStem(stem)
	const safeExt = ext.replace(/[^a-z0-9.]/g, "")
	return `${slug}${safeExt}`
}

function slugStem(stem: string): string {
	const slug = stem
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80)
	return slug.length > 0 ? slug : "file"
}

function extFromMimeOrName(mime: string, filename: string): string {
	const fromName = filename.lastIndexOf(".")
	if (fromName >= 0) return filename.slice(fromName).toLowerCase()
	if (mime === "image/jpeg") return ".jpg"
	if (mime === "image/png") return ".png"
	if (mime === "image/gif") return ".gif"
	if (mime === "image/webp") return ".webp"
	if (mime === "audio/ogg" || mime === "application/ogg") return ".ogg"
	if (mime === "video/ogg") return ".ogv"
	if (mime === "video/webm") return ".webm"
	if (mime === "video/mp4") return ".mp4"
	return ""
}

export type PlayableVideoCandidate = {
	readonly url: string
	readonly mime: string
	readonly size: number
}

/** Strip codec parameters from a Commons `type` / MIME string. */
export function videoMimeBase(mime: string): string {
	const base = mime.split(";")[0]
	if (base === undefined) return ""
	return base.trim().toLowerCase()
}

export function isBrowserPlayableVideoMime(mime: string): boolean {
	const base = videoMimeBase(mime)
	return base === "video/webm" || base === "video/mp4"
}

/** Estimate TimedMediaHandler transcode size from bitrate and duration. */
export function estimateTranscodeBytes(
	bandwidth: number,
	durationSec: number,
): number {
	return Math.round((bandwidth * durationSec) / 8)
}

/**
 * Largest Chromium-playable candidate that fits under `maxBytes`.
 * `.ogv` / Theora originals are skipped even when they are small.
 */
export function pickPlayableVideoUrl(
	candidates: readonly PlayableVideoCandidate[],
	maxBytes = MAX_ORIGINAL_BYTES,
): string | undefined {
	let best: PlayableVideoCandidate | undefined
	for (const candidate of candidates) {
		if (!isBrowserPlayableVideoMime(candidate.mime)) continue
		if (candidate.size <= 0 || candidate.size > maxBytes) continue
		if (best === undefined || candidate.size > best.size) best = candidate
	}
	return best?.url
}

function normalizeLicenseToken(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}

/**
 * Map Commons `License` / `LicenseShortName` onto a family, or `undefined`
 * when the file is not free enough for the official demo library.
 */
export function licenseFamilyOf(
	license: string,
	shortName: string,
): LicenseFamily | undefined {
	const tokens = [license, shortName]
		.map(normalizeLicenseToken)
		.filter((token) => token.length > 0)
	for (const token of tokens) {
		if (
			/(?:^|-)nc(?:-|$)/.test(token) ||
			/(?:^|-)nd(?:-|$)/.test(token) ||
			token.includes("all-rights")
		) {
			return undefined
		}
	}
	for (const token of tokens) {
		if (
			token === "pd" ||
			token.startsWith("pd-") ||
			token === "public-domain" ||
			token === "no-restrictions" ||
			token === "no-known-copyright"
		) {
			return "pd"
		}
		if (token === "cc0" || token.startsWith("cc0-") || token === "cc-zero") {
			return "cc0"
		}
		if (token.includes("by-sa")) return "cc-by-sa"
		if (token.startsWith("cc-by") || token === "cc-by") return "cc-by"
	}
	return undefined
}

function metaPath(cacheDir: string, title: string): string {
	return join(cacheDir, cacheKey(title), "meta.json")
}

function bodyPath(cacheDir: string, title: string, filename: string): string {
	return join(cacheDir, cacheKey(title), filename)
}

function parseCacheMeta(raw: unknown): CacheMeta | undefined {
	if (!isRecord(raw)) return undefined
	const title = asString(raw.title)
	const url = asString(raw.url)
	const pageUrl = asString(raw.pageUrl)
	const mime = asString(raw.mime)
	const license = asString(raw.license)
	const filename = asString(raw.filename)
	const bytes = asNumber(raw.bytes)
	if (
		title === undefined ||
		url === undefined ||
		pageUrl === undefined ||
		mime === undefined ||
		license === undefined ||
		filename === undefined ||
		bytes === undefined
	) {
		return undefined
	}
	return { title, url, pageUrl, mime, license, filename, bytes }
}

async function readCache(
	cacheDir: string,
	title: string,
): Promise<DownloadedFile | undefined> {
	const sidecar = metaPath(cacheDir, title)
	if (!existsSync(sidecar)) return undefined
	let parsed: unknown
	try {
		parsed = JSON.parse(await readFile(sidecar, "utf8"))
	} catch {
		return undefined
	}
	const meta = parseCacheMeta(parsed)
	if (meta === undefined) return undefined
	const path = bodyPath(cacheDir, title, meta.filename)
	if (!existsSync(path)) return undefined
	if (licenseFamilyOf(meta.license, meta.license) === undefined)
		return undefined
	return {
		title: meta.title,
		path,
		filename: seedFilename(meta.title),
		mime: meta.mime,
		license: meta.license,
		pageUrl: meta.pageUrl,
		bytes: meta.bytes,
	}
}

async function writeCache(
	cacheDir: string,
	file: DownloadedFile,
	url: string,
): Promise<void> {
	const dir = join(cacheDir, cacheKey(file.title))
	await mkdir(dir, { recursive: true })
	const dest = bodyPath(cacheDir, file.title, file.filename)
	if (file.path !== dest) {
		const bytes = await readFile(file.path)
		await writeFile(dest, bytes)
	}
	const meta: CacheMeta = {
		title: file.title,
		url,
		pageUrl: file.pageUrl,
		mime: file.mime,
		license: file.license,
		filename: file.filename,
		bytes: file.bytes,
	}
	await writeFile(
		metaPath(cacheDir, file.title),
		`${JSON.stringify(meta, null, "\t")}\n`,
	)
}

function metadataValue(
	extmetadata: Record<string, unknown> | undefined,
	key: string,
): string {
	if (extmetadata === undefined) return ""
	const entry = extmetadata[key]
	if (!isRecord(entry)) return ""
	return asString(entry.value) ?? ""
}

type CommonsInfo = {
	readonly url: string
	readonly thumburl: string | undefined
	readonly descriptionurl: string
	readonly mime: string
	readonly size: number
	readonly license: string
	readonly licenseShort: string
}

function parseImageInfo(raw: unknown): CommonsInfo | undefined {
	if (!isRecord(raw)) return undefined
	const url = asString(raw.url)
	const mime = asString(raw.mime)
	const size = asNumber(raw.size)
	const descriptionurl = asString(raw.descriptionurl)
	if (url === undefined || mime === undefined || size === undefined) {
		return undefined
	}
	const ext = isRecord(raw.extmetadata) ? raw.extmetadata : undefined
	return {
		url,
		thumburl: asString(raw.thumburl),
		descriptionurl: descriptionurl ?? "",
		mime,
		size,
		license: metadataValue(ext, "License"),
		licenseShort: metadataValue(ext, "LicenseShortName"),
	}
}

function pickStillOrOriginalUrl(info: CommonsInfo): string | undefined {
	const isStillImage =
		info.mime.startsWith("image/") && info.mime !== "image/gif"
	if (isStillImage && info.thumburl !== undefined && info.thumburl.length > 0) {
		return info.thumburl
	}
	if (info.size > MAX_ORIGINAL_BYTES) return undefined
	return info.url
}

type VideoDerivative = {
	readonly src: string
	readonly type: string
	readonly bandwidth: number | undefined
}

function parseVideoDerivatives(raw: unknown): readonly VideoDerivative[] {
	if (!Array.isArray(raw)) return []
	const out: VideoDerivative[] = []
	for (const item of raw) {
		if (!isRecord(item)) continue
		const src = asString(item.src)
		const type = asString(item.type)
		if (src === undefined || type === undefined) continue
		out.push({ src, type, bandwidth: asNumber(item.bandwidth) })
	}
	return out
}

function candidatesFromDerivatives(
	derivatives: readonly VideoDerivative[],
	durationSec: number | undefined,
): PlayableVideoCandidate[] {
	if (durationSec === undefined || durationSec <= 0) return []
	const out: PlayableVideoCandidate[] = []
	for (const row of derivatives) {
		if (row.bandwidth === undefined || row.bandwidth <= 0) continue
		out.push({
			url: row.src,
			mime: videoMimeBase(row.type),
			size: estimateTranscodeBytes(row.bandwidth, durationSec),
		})
	}
	return out
}

async function queryVideoDerivatives(title: string): Promise<{
	readonly durationSec: number | undefined
	readonly derivatives: readonly VideoDerivative[]
}> {
	const params = new URLSearchParams({
		action: "query",
		titles: title,
		prop: "videoinfo",
		viprop: "canonicaltitle|url|size|mime|derivatives",
		format: "json",
		formatversion: "2",
		origin: "*",
		redirects: "1",
	})
	const payload = await fetchJson(`${COMMONS_API}?${params.toString()}`)
	const page = pageFromQuery(payload)
	if (!isRecord(page)) {
		return { durationSec: undefined, derivatives: [] }
	}
	const videoinfo = page.videoinfo
	if (!Array.isArray(videoinfo) || videoinfo[0] === undefined) {
		return { durationSec: undefined, derivatives: [] }
	}
	const first = videoinfo[0]
	if (!isRecord(first)) {
		return { durationSec: undefined, derivatives: [] }
	}
	return {
		durationSec: asNumber(first.duration),
		derivatives: parseVideoDerivatives(first.derivatives),
	}
}

async function resolveVideoUrl(
	title: string,
	info: CommonsInfo,
): Promise<string | undefined> {
	const original: PlayableVideoCandidate = {
		url: info.url,
		mime: info.mime,
		size: info.size,
	}
	const fromOriginal = pickPlayableVideoUrl([original])
	if (fromOriginal !== undefined) return fromOriginal
	const extras = await queryVideoDerivatives(title)
	return pickPlayableVideoUrl([
		original,
		...candidatesFromDerivatives(extras.derivatives, extras.durationSec),
	])
}

async function resolveDownloadUrl(
	title: string,
	info: CommonsInfo,
): Promise<string | undefined> {
	if (info.mime.startsWith("video/")) {
		return resolveVideoUrl(title, info)
	}
	return pickStillOrOriginalUrl(info)
}

async function fetchJson(url: string): Promise<unknown> {
	const res = await fetch(url, {
		headers: { "user-agent": SEED_USER_AGENT, accept: "application/json" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!res.ok) {
		throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
	}
	return res.json()
}

async function fetchBytes(url: string): Promise<Buffer> {
	const res = await fetch(url, {
		headers: { "user-agent": SEED_USER_AGENT },
		redirect: "follow",
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!res.ok) {
		throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
	}
	return Buffer.from(await res.arrayBuffer())
}

function pageFromQuery(payload: unknown): unknown {
	if (!isRecord(payload)) return undefined
	const query = payload.query
	if (!isRecord(query)) return undefined
	const pages = query.pages
	if (!Array.isArray(pages) || pages[0] === undefined) return undefined
	return pages[0]
}

async function queryCommons(title: string): Promise<CommonsInfo> {
	const params = new URLSearchParams({
		action: "query",
		titles: title,
		prop: "imageinfo",
		iiprop: "url|extmetadata|mime|size",
		iiurlwidth: "1600",
		format: "json",
		formatversion: "2",
		origin: "*",
		redirects: "1",
	})
	const payload = await fetchJson(`${COMMONS_API}?${params.toString()}`)
	const page = pageFromQuery(payload)
	if (!isRecord(page) || page.missing === true) {
		throw new Error(`Commons page missing: ${title}`)
	}
	const imageinfo = page.imageinfo
	if (!Array.isArray(imageinfo) || imageinfo[0] === undefined) {
		throw new Error(`Commons imageinfo missing: ${title}`)
	}
	const info = parseImageInfo(imageinfo[0])
	if (info === undefined) {
		throw new Error(`Commons imageinfo unreadable: ${title}`)
	}
	return info
}

async function resolveOne(
	media: CommonsMedia,
	opts: DownloadOptions,
): Promise<DownloadedFile> {
	const cached = await readCache(opts.cacheDir, media.title)
	if (cached !== undefined) return cached
	if (opts.skipDownload) {
		throw new Error(`cache miss for ${media.title} (--skip-download)`)
	}
	const info = await queryCommons(media.title)
	const family = licenseFamilyOf(info.license, info.licenseShort)
	if (family === undefined) {
		throw new Error(
			`license not allowed for ${media.title}: ${info.license || info.licenseShort || "(none)"}`,
		)
	}
	const url = await resolveDownloadUrl(media.title, info)
	if (url === undefined) {
		throw new Error(
			`no browser-playable download under ${MAX_ORIGINAL_BYTES} bytes: ${media.title}`,
		)
	}
	const bytes = await fetchBytes(url)
	const filename = seedFilename(media.title)
	const ext = extFromMimeOrName(info.mime, filename)
	const safeName =
		filename.toLowerCase().endsWith(ext) || ext.length === 0
			? filename
			: `${filename}${ext}`
	const dir = join(opts.cacheDir, cacheKey(media.title))
	await mkdir(dir, { recursive: true })
	const path = bodyPath(opts.cacheDir, media.title, safeName)
	await writeFile(path, bytes)
	const file: DownloadedFile = {
		title: media.title,
		path,
		filename: safeName,
		mime: info.mime,
		license: info.license || info.licenseShort,
		pageUrl: info.descriptionurl,
		bytes: bytes.byteLength,
	}
	await writeCache(opts.cacheDir, file, url)
	return file
}

async function resolveOneWithRetry(
	media: CommonsMedia,
	opts: DownloadOptions,
): Promise<DownloadedFile> {
	try {
		return await resolveOne(media, opts)
	} catch (first) {
		if (opts.skipDownload) throw first
		return await resolveOne(media, opts)
	}
}

async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length)
	let next = 0
	async function run(): Promise<void> {
		while (next < items.length) {
			const index = next
			next += 1
			const item = items[index]
			if (item === undefined) continue
			out[index] = await worker(item)
		}
	}
	const workers: Promise<void>[] = []
	for (let i = 0; i < Math.min(limit, items.length); i += 1) {
		workers.push(run())
	}
	await Promise.all(workers)
	return out
}

/**
 * Download (or load from cache) every distinct Commons file. Failures are
 * collected as warnings; successful files are keyed by Commons title.
 */
export async function resolveMedia(
	media: readonly CommonsMedia[],
	opts: DownloadOptions,
): Promise<ResolveResult> {
	await mkdir(opts.cacheDir, { recursive: true })
	const unique = new Map<string, CommonsMedia>()
	for (const item of media) {
		if (!unique.has(item.title)) unique.set(item.title, item)
	}
	const list = [...unique.values()]
	const warnings: ResolveWarning[] = []
	const files = new Map<string, DownloadedFile>()
	const results = await mapLimit(list, 2, async (item) => {
		try {
			return { title: item.title, file: await resolveOneWithRetry(item, opts) }
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return { title: item.title, error: message }
		}
	})
	for (const row of results) {
		if ("file" in row && row.file !== undefined) {
			files.set(row.title, row.file)
		} else if ("error" in row && row.error !== undefined) {
			warnings.push({ title: row.title, message: row.error })
		}
	}
	return { files, warnings }
}
