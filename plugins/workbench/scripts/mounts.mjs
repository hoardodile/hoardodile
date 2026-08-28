/**
 * The workbench's HTTP surface, shared by the vite dev server
 * (`vite.config.ts`) and the published standalone server (`serve.mjs`)
 * so the two can never drift.
 *
 * Everything the page needs about a resource arrives through provider
 * callbacks. That is what keeps this package dependency-free while
 * still reaching real data: `hoardodile plugin dev` owns the sandbox,
 * the storage reader and the render pipeline, and passes them in. Run
 * standalone against a plain directory, the built-in providers below
 * cover the offline case.
 *
 * Routes:
 *   GET /plugin/*                                  built plugin bundle
 *   GET /data/<path>[?res=]                        raw entry bytes
 *   GET /data/?list=1[&res=]                       entry names
 *   GET /data/?stat=<path>[&res=]                  entry size
 *   GET /api/workbench/resources                   resource picker list
 *   GET /api/workbench/context?res=<id>            hooks + seeded state
 *   GET /api/resources/:id/files/:token/*          plugin file URLs
 *       …?size=preview                             preview variant
 *   GET /api/resources/:id/frame/:token/:name/:ms  video seek frame
 */

import { createHash } from "node:crypto"
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { join, resolve, sep } from "node:path"

export function contentTypeOf(path) {
	const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
	switch (ext) {
		case ".html":
			return "text/html; charset=utf-8"
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8"
		case ".css":
			return "text/css; charset=utf-8"
		case ".json":
			return "application/json; charset=utf-8"
		case ".svg":
			return "image/svg+xml"
		case ".png":
			return "image/png"
		case ".jpg":
		case ".jpeg":
			return "image/jpeg"
		case ".gif":
			return "image/gif"
		case ".webp":
			return "image/webp"
		case ".avif":
			return "image/avif"
		case ".mp4":
			return "video/mp4"
		case ".webm":
			return "video/webm"
		case ".mp3":
			return "audio/mpeg"
		case ".flac":
			return "audio/flac"
		case ".wav":
			return "audio/wav"
		case ".woff2":
			return "font/woff2"
		case ".woff":
			return "font/woff"
		default:
			return "application/octet-stream"
	}
}

function walkFiles(root) {
	const out = []
	function walk(current, prefix) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) walk(join(current, entry.name), rel)
			else if (entry.isFile()) out.push(rel)
		}
	}
	walk(root, "")
	return out.sort()
}

/** Resolve `rel` under `root`, or `undefined` when it escapes. */
function safeJoin(root, rel) {
	const abs = resolve(root, rel)
	if (abs !== root && !abs.startsWith(root + sep)) return undefined
	return abs
}

function sendJson(res, value) {
	res.setHeader("content-type", "application/json; charset=utf-8")
	res.setHeader("cache-control", "no-store")
	res.end(JSON.stringify(value ?? null))
}

function sendBytes(res, contentType, bytes) {
	res.setHeader("content-type", contentType)
	res.end(bytes)
}

function notFound(res) {
	res.statusCode = 404
	res.end("not found")
}

/**
 * Providers over one plain directory — the offline default, and what a
 * standalone `serve.mjs --data <dir>` uses. The directory stands in for
 * a single resource.
 */
export function createDirectoryProviders(dataDir, resId = "workbench") {
	const root = resolve(dataDir)
	return {
		resources: () => [{ id: resId, name: "Workbench" }],
		files: {
			list: () => walkFiles(root),
			stat: (_resId, path) => {
				const abs = safeJoin(root, path)
				if (abs === undefined || !existsSync(abs)) return undefined
				const info = statSync(abs)
				return info.isFile() ? { sizeBytes: info.size } : undefined
			},
			read: (_resId, path) => {
				const abs = safeJoin(root, path)
				if (abs === undefined || !existsSync(abs)) return undefined
				if (statSync(abs).isDirectory()) return undefined
				return readFileSync(abs)
			},
		},
	}
}

/**
 * Mobile viewport initial-scale factor injected into every served plugin
 * page — the host server runs `wrapHtml` with the same value
 * (apps/server/src/infra/http/plugin-render.ts). NOTE: keep in sync with
 * `MOBILE_INITIAL_SCALE` in `@hoardodile/ui/viewport` (single source of
 * truth, Design.md — Layout); `mounts.test.ts` guards the alignment.
 * This module stays dependency-free, so the constant is mirrored, not
 * imported.
 */
const PLUGIN_SHELL_VIEWPORT_SCALE = 0.8

/**
 * Wraps a plugin page in the same shell the host server produces
 * (plugin-render.ts `wrapHtml`, kept byte-identical): the viewport meta
 * the app injects, the overflow reset, and the postMessage bridge that
 * exposes `__pluginContext` / `__pluginVisibility` as CustomEvents for
 * SDK builds that predate the pure-postMessage protocol.
 */
export function wrapPluginHtml(body) {
	return [
		"<!DOCTYPE html>",
		"<html>",
		"<head>",
		'<meta charset="utf-8">',
		`<meta name="viewport" content="width=device-width, initial-scale=${PLUGIN_SHELL_VIEWPORT_SCALE}, maximum-scale=1.0, user-scalable=0">`,
		'<style type="text/css">html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style>',
		"</head>",
		"<body>",
		`<script>(function(){window.__pluginContext=undefined;window.__pluginVisibility=undefined;window.addEventListener("message",function(e){if(e.source!==window.parent)return;if(e.data?.type==="push"){if(e.data?.key==="context"){window.__pluginContext=e.data.data;window.dispatchEvent(new CustomEvent("context-ready",{detail:e.data.data}))}else if(e.data?.key==="visibility"){window.__pluginVisibility=e.data.data;window.dispatchEvent(new CustomEvent("visibility-changed",{detail:e.data.data}))}}})})();</script>`,
		body,
		"</body>",
		"</html>",
	].join("")
}

/** Read-only mount of a directory under `basePath` (the plugin bundle). */
function staticMount(basePath, dir) {
	const root = resolve(dir)
	return (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
			return false
		}
		// Sandboxed plugin iframes have the opaque origin "null"; their
		// asset fetches need permissive CORS, same as the real server's
		// plugin render route.
		res.setHeader("access-control-allow-origin", "*")
		const rel = decodeURIComponent(url.pathname.slice(basePath.length)).replace(
			/^\/+/,
			"",
		)
		const abs = safeJoin(root, rel)
		if (abs === undefined) {
			res.statusCode = 403
			res.end("forbidden")
			return true
		}
		if (!existsSync(abs) || statSync(abs).isDirectory()) {
			notFound(res)
			return true
		}
		const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase()
		if (ext === ".html") {
			// Mirror the host server: the page runs in a sandboxed iframe
			// (no allow-same-origin). The same sandbox via CSP keeps it in
			// an opaque origin even top-level; frame-ancestors restricts
			// embedding to the workbench origin (the page and /plugin/*
			// share it, so the embedded workbench keeps working).
			res.setHeader(
				"content-security-policy",
				"sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'",
			)
			res.setHeader("x-content-type-options", "nosniff")
			sendBytes(
				res,
				contentTypeOf(abs),
				wrapPluginHtml(readFileSync(abs, "utf-8")),
			)
			return true
		}
		sendBytes(res, contentTypeOf(abs), readFileSync(abs))
		return true
	}
}

/** `/data` mount: entry listing, stat and bytes for the selected resource. */
function dataMount(files) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		if (url.pathname !== "/data" && !url.pathname.startsWith("/data/")) {
			return false
		}
		res.setHeader("access-control-allow-origin", "*")
		const resId = url.searchParams.get("res") ?? ""
		if (url.searchParams.has("list")) {
			sendJson(res, await files.list(resId))
			return true
		}
		const statPath = url.searchParams.get("stat")
		if (statPath !== null) {
			const stat = await files.stat(resId, decodeURIComponent(statPath))
			sendJson(res, stat === undefined ? null : stat.sizeBytes)
			return true
		}
		const rel = decodeURIComponent(url.pathname.slice("/data".length)).replace(
			/^\/+/,
			"",
		)
		const bytes = await files.read(resId, rel)
		if (bytes === undefined) {
			notFound(res)
			return true
		}
		sendBytes(res, contentTypeOf(rel), bytes)
		return true
	}
}

const FILE_URL_RE = /^\/api\/resources\/([^/]+)\/files\/(?:[^/]*)\/(.+)$/
const COVER_URL_RE = /^\/api\/resources\/([^/]+)\/cover$/
const FRAME_URL_RE =
	/^\/api\/resources\/([^/]+)\/frame\/(?:[^/]*)\/([^/]+)\/([^/]+)$/
const EXTRACTED_URL_RE =
	/^\/api\/resources\/([^/]+)\/extracted\/(?:[^/]*)\/(.+)$/
// NOTE: keep the token-path route family in sync with the server's auth
// preHandler and the web service worker (see
// apps/server/src/infra/http/plugin.ts). The cover route mirrors the
// server's token-free `GET /api/resources/:id/cover`.

/**
 * The resource cover, rendered the way the app does it (`coverLocal`
 * pick -> thumb pipeline). Mirrors the server's
 * `GET /api/resources/:id/cover?size=thumb`; a missing cover or render
 * surfaces as the same placeholder-shaped 404 the app sends.
 */
function coverMount(cover) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		const match = url.pathname.match(COVER_URL_RE)
		if (match === null) return false
		res.setHeader("access-control-allow-origin", "*")
		const rendered = await cover(decodeURIComponent(match[1] ?? ""))
		if (rendered === undefined) {
			res.statusCode = 404
			res.setHeader("content-type", "application/json")
			res.end('{"error":"no cover","reason":"placeholder"}')
			return true
		}
		sendBytes(res, rendered.contentType, readRendered(rendered))
		return true
	}
}

/**
 * The plugin file URL shape the real server exposes. `?size=preview`
 * (and the generic variant parameters `fmt`/`fit`/`area`/`q`) goes
 * through the render provider when one is wired, so the workbench
 * serves the same derived variant production does; without a provider
 * it falls back to the original bytes.
 */
function resourceFilesMount(files, preview) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		const match = url.pathname.match(FILE_URL_RE)
		if (match === null) return false
		res.setHeader("access-control-allow-origin", "*")
		const resId = decodeURIComponent(match[1] ?? "")
		const rel = decodeURIComponent(match[2] ?? "")
		const variantQuery = collectVariantQuery(url)
		if (variantQuery !== undefined && preview !== undefined) {
			const rendered = await preview(resId, rel, variantQuery)
			if (rendered !== undefined) {
				sendBytes(res, rendered.contentType, readRendered(rendered))
				return true
			}
		}
		const bytes = await files.read(resId, rel)
		if (bytes === undefined) {
			notFound(res)
			return true
		}
		sendBytes(res, contentTypeOf(rel), bytes)
		return true
	}
}

/**
 * The variant parameters of a file URL, or `undefined` when none are
 * present. Raw strings pass through untouched — the render provider
 * parses and validates them.
 */
function collectVariantQuery(url) {
	const get = (name) => url.searchParams.get(name)
	const size = get("size")
	const fmt = get("fmt")
	const fit = get("fit")
	const area = get("area")
	const q = get("q")
	const requested =
		size === "preview" ||
		fmt !== null ||
		fit !== null ||
		area !== null ||
		q !== null
	if (!requested) return undefined
	const query = {}
	if (size !== null) query.size = size
	if (fmt !== null) query.fmt = fmt
	if (fit !== null) query.fit = fit
	if (area !== null) query.area = area
	if (q !== null) query.q = q
	return query
}

/** Video seek-preview frames, rendered on demand by the provider. */
function frameMount(frame) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		const match = url.pathname.match(FRAME_URL_RE)
		if (match === null) return false
		res.setHeader("access-control-allow-origin", "*")
		const timeMs = Number(match[3])
		if (!Number.isFinite(timeMs) || timeMs < 0) {
			res.statusCode = 400
			res.end("invalid time")
			return true
		}
		const rendered = await frame(
			decodeURIComponent(match[1] ?? ""),
			decodeURIComponent(match[2] ?? ""),
			timeMs,
		)
		if (rendered === undefined) {
			notFound(res)
			return true
		}
		sendBytes(res, rendered.contentType, readRendered(rendered))
		return true
	}
}

/**
 * Files materialized by the plugin's `extractArchive` hook. The
 * production server reads them from the extraction cache; the workbench
 * delegates to the same provider the CLI wires.
 */
function extractedMount(files) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		const match = url.pathname.match(EXTRACTED_URL_RE)
		if (match === null) return false
		if (files.extracted === undefined) return false
		res.setHeader("access-control-allow-origin", "*")
		const resId = decodeURIComponent(match[1] ?? "")
		const rel = decodeURIComponent(match[2] ?? "")
		const bytes = await files.extracted(resId, rel)
		if (bytes === undefined) {
			notFound(res)
			return true
		}
		sendBytes(res, contentTypeOf(rel), bytes)
		return true
	}
}

/** A render provider may answer with bytes in hand or a cached path. */
function readRendered(rendered) {
	return rendered.bytes ?? readFileSync(rendered.path)
}

/**
 * The page's own API: which resources can be opened, and everything
 * known about the selected one (sandboxed hook results plus the
 * plugin-visible state used to seed the mock host).
 */
function workbenchApiMount(providers) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		if (!url.pathname.startsWith("/api/workbench/")) return false
		res.setHeader("access-control-allow-origin", "*")
		if (url.pathname === "/api/workbench/resources") {
			sendJson(res, await providers.resources())
			return true
		}
		if (url.pathname === "/api/workbench/context") {
			const resId = url.searchParams.get("res") ?? ""
			const [snapshot, state] = await Promise.all([
				providers.snapshot?.(resId),
				providers.state?.(resId),
			])
			sendJson(res, {
				resId,
				snapshot: snapshot ?? null,
				state: state ?? null,
				// Rendering capabilities the page surfaces in its status
				// line, so a missing one reads as "not wired" rather than
				// as a broken plugin.
				capabilities: {
					preview: providers.preview !== undefined,
					frame: providers.frame !== undefined,
				},
			})
			return true
		}
		notFound(res)
		return true
	}
}

/**
 * Build the workbench's request handlers in match order. Each returns
 * `true` when it handled the request.
 */
export function createWorkbenchMounts(opts) {
	const { pluginDir, providers } = opts
	const mounts = []
	if (pluginDir !== undefined) mounts.push(staticMount("/plugin", pluginDir))
	if (providers.files !== undefined) {
		mounts.push(dataMount(providers.files))
		mounts.push(resourceFilesMount(providers.files, providers.preview))
		mounts.push(extractedMount(providers.files))
	}
	if (providers.cover !== undefined) mounts.push(coverMount(providers.cover))
	if (providers.frame !== undefined) mounts.push(frameMount(providers.frame))
	if (opts.vault !== undefined) {
		mounts.push(pluginAssetsMount(opts.vault))
		mounts.push(workbenchVaultMount(opts.vault))
	}
	mounts.push(workbenchApiMount(providers))
	return mounts
}

// ── Plugin asset vault (workbench dev) ────────────────────────────────────

const ASSET_URL_RE = /^\/api\/plugin-assets\/([^/]+)\/(?:[^/]*)\/(.+)$/
const VAULT_DOWNLOAD_PATH = "/api/workbench/vault/download"
const VAULT_DELETE_PATH = "/api/workbench/vault/delete"

/**
 * Dev-only mirror of the server's plugin asset pipeline, in the plain
 * dependency-free module the standalone workbench ships:
 *
 * - `GET /api/plugin-assets/:id/:token/*` serves the local vault
 *   (token accepted verbatim — dev; the app issues HMAC-scoped ones).
 *   `nosniff`, `access-control-allow-origin: *` (opaque-origin iframe),
 *   HTML demoted to an attachment, `no-store` cache.
 * - policy mirrors the server where it matters: http(s) only, no URL
 *   userinfo, IP-literal public-address rule (unless
 *   `WORKBENCH_VAULT_ALLOW_PRIVATE=1`), ≤5 redirects, size cap
 *   (`WORKBENCH_VAULT_MAX_BYTES`, default 200 MiB), optional sha256 pin,
 *   atomic temp→rename write, dest confined to the plugin's vault
 *   directory.
 */
function pluginAssetsMount(vaultRoot) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		const match = url.pathname.match(ASSET_URL_RE)
		if (match === null) return false
		const abs = vaultFile(
			vaultRoot,
			decodeURIComponent(match[1] ?? ""),
			decodeURIComponent(match[2] ?? ""),
		)
		if (abs === undefined) {
			res.statusCode = 403
			res.end("forbidden")
			return true
		}
		let info
		try {
			info = statSync(abs)
		} catch {
			info = undefined
		}
		if (info === undefined || !info.isFile()) {
			notFound(res)
			return true
		}
		res.setHeader("x-content-type-options", "nosniff")
		res.setHeader("access-control-allow-origin", "*")
		res.setHeader("cache-control", "no-store")
		const ext = `.${abs.slice(abs.lastIndexOf(".") + 1).toLowerCase()}`
		const isHtml = ext === ".html" || ext === ".htm"
		res.setHeader(
			"content-type",
			isHtml ? "application/octet-stream" : contentTypeOf(abs),
		)
		if (isHtml) {
			res.setHeader("content-disposition", "attachment")
		}
		res.end(readFileSync(abs))
		return true
	}
}

function workbenchVaultMount(vaultRoot) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://workbench.local")
		if (
			url.pathname === VAULT_DOWNLOAD_PATH &&
			(req.method === "POST" || req.method === "PUT")
		) {
			await handleVaultDownload(
				req,
				res,
				vaultRoot,
				url.searchParams.get("force") === "1",
			)
			return true
		}
		if (url.pathname === VAULT_DELETE_PATH && req.method === "POST") {
			const body = await readJsonBody(req)
			const { pluginId, path } = body ?? {}
			if (typeof pluginId !== "string" || typeof path !== "string") {
				sendJson(res, { error: "pluginId and path are required" })
				return true
			}
			const abs = vaultFile(vaultRoot, pluginId, path)
			if (abs === undefined || !validVaultDest(path)) {
				res.statusCode = 403
				res.end("forbidden")
				return true
			}
			let existed = false
			try {
				existed = statSync(abs).isFile()
			} catch {
				existed = false
			}
			if (existed) rmSync(abs)
			sendJson(res, { existed })
			return true
		}
		return false
	}
}

async function handleVaultDownload(req, res, vaultRoot, force) {
	const body = await readJsonBody(req)
	const { pluginId, url, dest, sha256 } = body ?? {}
	if (
		typeof pluginId !== "string" ||
		typeof url !== "string" ||
		typeof dest !== "string"
	) {
		sendJson(res, { error: "pluginId, url and dest are required" })
		return
	}
	const abs = vaultFile(vaultRoot, pluginId, dest)
	if (abs === undefined || !validVaultDest(dest)) {
		res.statusCode = 403
		res.end("forbidden")
		return
	}

	// Cache-first: an existing destination resolves without consent;
	// without `force` a miss answers `missing` (the page then asks the
	// user and re-issues with `force`).
	let existing
	try {
		const info = statSync(abs)
		existing = info.isFile() ? { path: dest, sizeBytes: info.size } : undefined
	} catch {
		existing = undefined
	}
	if (existing !== undefined) {
		sendJson(res, {
			status: "cached",
			path: existing.path,
			sizeBytes: existing.sizeBytes,
			sha256: sha256File(abs),
		})
		return
	}
	if (!force) {
		sendJson(res, { status: "missing" })
		return
	}

	const maxBytes =
		Number(process.env.WORKBENCH_VAULT_MAX_BYTES) || 200 * 1024 * 1024
	try {
		const fetched = await fetchWithPolicy(url, maxBytes)
		if (sha256 !== undefined && fetched.sha256 !== sha256) {
			throw new Error(
				`sha256 mismatch: expected ${sha256}, got ${fetched.sha256}`,
			)
		}
		mkdirSync(resolve(abs, ".."), { recursive: true })
		const tmp = `${abs}.tmp-${Date.now()}`
		writeFileSync(tmp, fetched.bytes)
		renameSync(tmp, abs)
		sendJson(res, {
			status: "downloaded",
			path: dest,
			sizeBytes: fetched.bytes.length,
			sha256: fetched.sha256,
		})
	} catch (err) {
		sendJson(res, {
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/** A vault file path under `<root>/<pluginId>/<dest>`, or undefined. */
function vaultFile(vaultRoot, pluginId, dest) {
	if (typeof pluginId !== "string" || pluginId.length === 0) return undefined
	return safeJoin(resolve(vaultRoot), `${pluginId}/${dest}`)
}

/** Dev mirror of the server's dest rules: no empty/`.`, no `..`, no separators inside a segment. */
function validVaultDest(dest) {
	return (
		typeof dest === "string" &&
		dest.length > 0 &&
		dest
			.split("/")
			.every(
				(s) =>
					s.length > 0 &&
					s !== "." &&
					s !== ".." &&
					!s.includes("\\") &&
					!s.includes(":"),
			)
	)
}

/** Fetch with the dev-policy subset: http(s), no userinfo, IP-literal public-address rule, ≤5 redirects, size cap. */
async function fetchWithPolicy(rawUrl, maxBytes) {
	let url = new URL(rawUrl)
	const allowPrivate = process.env.WORKBENCH_VAULT_ALLOW_PRIVATE === "1"
	function vet(next) {
		if (next.protocol !== "http:" && next.protocol !== "https:") {
			throw new Error(`unsupported scheme: ${next.protocol}`)
		}
		if (next.username.length > 0 || next.password.length > 0) {
			throw new Error("URLs must not embed credentials")
		}
		if (!allowPrivate) {
			const verdict = ipLiteralVerdict(next.hostname)
			if (verdict === false) {
				throw new Error(
					`address is not public: ${next.hostname} — set WORKBENCH_VAULT_ALLOW_PRIVATE=1 to allow private ranges`,
				)
			}
		}
		return next
	}
	vet(url)
	for (let hop = 0; hop <= 5; hop++) {
		const response = await fetch(url, { redirect: "manual" })
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location")
			if (location === null)
				throw new Error("redirect without a Location header")
			url = vet(new URL(location, url))
			continue
		}
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`HTTP ${response.status} from ${url.href}`)
		}
		if (response.body === null) throw new Error("empty response body")
		const hash = createHash("sha256")
		const chunks = []
		let seen = 0
		for await (const chunk of response.body) {
			seen += chunk.length
			if (seen > maxBytes) {
				throw new Error(`response exceeds the ${maxBytes}-byte cap`)
			}
			hash.update(chunk)
			chunks.push(chunk)
		}
		const bytes = Buffer.concat(chunks)
		return { bytes, sha256: hash.digest("hex") }
	}
	throw new Error("more than 5 redirects")
}

/**
 * Workbench dev mirror of the server's IP-literal public-address rule
 * (see `packages/shared` `isPublicAddress`): private, loopback,
 * link-local, CGNAT, documentation, benchmarking and multicast ranges
 * are not globally routable. Returns `undefined` for hostnames — the dev
 * tool deliberately does not resolve DNS per hop (fake-IP proxies and
 * split-horizon DNS would make it unusable); the app's resolve-time
 * pinning stays a server-side feature.
 */
function ipLiteralVerdict(address) {
	if (!address.includes(":") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
		return undefined
	}
	// The URL hostname keeps the IPv6 brackets — strip them before any
	// range matching.
	if (address.startsWith("[") && address.endsWith("]")) {
		address = address.slice(1, -1)
	}
	if (!address.includes(":")) {
		const parts = address.split(".").map(Number)
		const [a, b, c] = parts
		if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
			return undefined
		}
		if (a === 0 || a === 10 || a === 127) return false
		if (a === 169 && b === 254) return false
		if (a === 172 && b >= 16 && b <= 31) return false
		if (a === 192 && b === 168) return false
		if (a === 100 && b >= 64 && b <= 127) return false
		if (a === 192 && b === 0 && c === 2) return false
		if (a === 198 && (b === 18 || b === 19)) return false
		if (a === 198 && b === 51 && c === 100) return false
		if (a === 203 && b === 0 && c === 113) return false
		if (a >= 224) return false
		return true
	}
	const lower = address.split("%")[0].toLowerCase()
	if (lower === "::" || lower === "::1") return false
	if (lower.startsWith("::ffff:")) {
		// The URL parser may normalize the dotted quad to hex groups
		// (e.g. ::ffff:127.0.0.1 → [::ffff:7f00:1]) — decode the embedded
		// IPv4 back out and re-check it.
		const digits = lower
			.slice("::ffff:".length)
			.split(":")
			.map((group) => group.padStart(4, "0"))
			.join("")
			.slice(-8)
		if (/^[0-9a-f]{8}$/.test(digits)) {
			const ipv4 = [0, 2, 4, 6]
				.map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16))
				.join(".")
			return ipLiteralVerdict(ipv4)
		}
		return true
	}
	if (lower.startsWith("fc") || lower.startsWith("fd")) return false
	if (
		lower.startsWith("fe8") ||
		lower.startsWith("fe9") ||
		lower.startsWith("fea") ||
		lower.startsWith("feb")
	) {
		return false
	}
	if (lower.startsWith("2001:db8:")) return false
	if (lower.startsWith("ff")) return false
	return true
}

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex")
}

async function readJsonBody(req) {
	const chunks = []
	for await (const chunk of req) chunks.push(chunk)
	const raw = Buffer.concat(chunks).toString("utf-8")
	if (raw.trim().length === 0) return undefined
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}
