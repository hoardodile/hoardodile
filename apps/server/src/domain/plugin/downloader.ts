/**
 * The plugin asset downloader: the host-side HTTP client that fetches a
 * user-approved asset. Runs in the server process (never inside the
 * plugin sandbox) and enforces every network policy before and during
 * the transfer:
 *
 * - http(s) only; `file:`/`data:`/junk schemes rejected (`POLICY`);
 * - URL userinfo (`https://user:pass@`) rejected;
 * - private / loopback / link-local / multicast addresses rejected at
 *   resolve time unless `allowPrivate` is set, and the socket is pinned
 *   to the vetted address via a custom `lookup` — DNS rebinding can
 *   never race the check;
 * - redirects followed manually, ≤ 5 hops, re-vetted per hop;
 * - streamed body with a hard byte cap (`maxBytes`): the transfer is
 *   aborted the moment the cap is crossed and the staging file is
 *   discarded by the caller;
 * - `Accept-Encoding: identity` so sizes and bytes are deterministic.
 *
 * Policy violations throw {@link PluginAssetError} with `POLICY`;
 * transport failures keep their own error names.
 */
import { createHash } from "node:crypto"
import { lookup as dnsLookup } from "node:dns"
import { createWriteStream } from "node:fs"
import http from "node:http"
import https from "node:https"
import { isIP } from "node:net"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { pluginAssetError } from "@hoardodile/sdk-types"

export type PluginDownloaderDeps = {
	/** Per-file byte cap — the stream is aborted as soon as it is crossed. */
	readonly maxBytes: number
	/** Per-request timeout, covering connect + body. */
	readonly timeoutMs: number
	/** Allow private/loopback addresses (explicit env opt-in). */
	readonly allowPrivate: boolean
}

export type PluginDownloader = {
	/**
	 * Validate a URL's scheme/userinfo/host policy up front, IP literals
	 * included — no network. Called before the consent dialog, so a URL
	 * that can never be fetched does not ask. Hostnames are vetted again
	 * per hop when the socket is pinned at fetch time.
	 */
	readonly vetUrl: (rawUrl: string) => string
	/**
	 * Fetch `url` into `targetPath` (a vault staging file). Resolves with
	 * the stored bytes' size and sha256, computed from the exact bytes
	 * written. The caller owns staging cleanup on failure.
	 */
	fetchToFile(
		url: string,
		targetPath: string,
	): Promise<{ readonly sizeBytes: number; readonly sha256: string }>
	/**
	 * Cheap `Content-Length` probe (`undefined` when the server does not
	 * report one or the probe fails). Only ever called AFTER the user
	 * approved — consent happens before any network touch.
	 */
	probeSize(url: string): Promise<number | undefined>
}

const DEFAULT_MAX_REDIRECTS = 5
const PROBE_TIMEOUT_MS = 3_000

/**
 * Validate a download URL's policy up front (scheme, userinfo, host) and
 * return its canonical string form. Address-family policy is enforced in
 * two stages: IP-literal hosts are rejected here (before consent is
 * asked), while hostnames are vetted per-hop by the pinned `lookup` at
 * fetch time — a renamed host (DNS change, rebinding) is still blocked
 * before the socket connects. Nothing contacts the network here.
 */
export function vetDownloadUrl(rawUrl: string): string {
	return parseHttpUrl(rawUrl).href
}

function parseHttpUrl(rawUrl: string): URL {
	if (typeof rawUrl !== "string" || rawUrl.length === 0) {
		throw pluginAssetError("POLICY", "plugin download URL must not be empty")
	}
	let url: URL
	try {
		url = new URL(rawUrl)
	} catch {
		throw pluginAssetError(
			"POLICY",
			`plugin download URL is invalid: ${rawUrl}`,
		)
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw pluginAssetError(
			"POLICY",
			`plugin download URL must use http(s), got ${url.protocol}: ${rawUrl}`,
		)
	}
	if (url.hostname.length === 0) {
		throw pluginAssetError("POLICY", "plugin download URL has no host")
	}
	if (url.username.length > 0 || url.password.length > 0) {
		throw pluginAssetError(
			"POLICY",
			"plugin download URL must not embed credentials",
		)
	}
	return url
}

export function createPluginDownloader(
	deps: PluginDownloaderDeps,
): PluginDownloader {
	/**
	 * IP-literal hosts bypass node's resolver entirely, so the custom
	 * lookup never sees them — they are vetted here, before the socket
	 * exists. Hostnames go through the pinned {@link pinnedLookup}.
	 */
	function assertHostAllowed(hostname: string): void {
		const family = isIP(hostname)
		if (family !== 0 && !deps.allowPrivate && !isPublicAddress(hostname)) {
			throw pluginAssetError(
				"POLICY",
				`plugin download address is not public: ${hostname} — enable PLUGIN_DOWNLOAD_ALLOW_PRIVATE to allow private ranges`,
			)
		}
	}

	function vetUrl(rawUrl: string): string {
		const url = parseHttpUrl(rawUrl)
		assertHostAllowed(url.hostname)
		return url.href
	}

	async function fetchToFile(
		rawUrl: string,
		targetPath: string,
	): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
		let url = parseHttpUrl(rawUrl)
		assertHostAllowed(url.hostname)
		let followed = 0
		for (;;) {
			const outcome = await transferOnce(url, targetPath)
			if (outcome.kind === "redirect") {
				followed += 1
				if (followed > DEFAULT_MAX_REDIRECTS) {
					throw pluginAssetError(
						"POLICY",
						`plugin download followed more than ${DEFAULT_MAX_REDIRECTS} redirects`,
					)
				}
				url = parseHttpUrl(new URL(outcome.location, url).href)
				assertHostAllowed(url.hostname)
				continue
			}
			return { sizeBytes: outcome.sizeBytes, sha256: outcome.sha256 }
		}
	}

	async function probeSize(rawUrl: string): Promise<number | undefined> {
		const url = parseHttpUrl(rawUrl)
		assertHostAllowed(url.hostname)
		try {
			const size = await new Promise<number | undefined>((resolve, reject) => {
				const req = requestUrl(url, {
					method: "HEAD",
					timeoutMs: PROBE_TIMEOUT_MS,
					onResponse: (res) => {
						const status = res.statusCode ?? 0
						if (status >= 200 && status < 300) {
							const len = res.headers["content-length"]
							const parsed = Array.isArray(len)
								? Number.parseInt(len[0] ?? "", 10)
								: Number.parseInt(len ?? "", 10)
							res.resume()
							resolve(
								Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
							)
						} else {
							res.resume()
							resolve(undefined)
						}
					},
				})
				req.on("error", reject)
			})
			return size
		} catch {
			return undefined
		}
	}

	async function transferOnce(
		url: URL,
		targetPath: string,
	): Promise<
		| {
				readonly kind: "done"
				readonly sizeBytes: number
				readonly sha256: string
		  }
		| { readonly kind: "redirect"; readonly location: string }
	> {
		return await new Promise((resolve, reject) => {
			const req = requestUrl(url, {
				method: "GET",
				timeoutMs: deps.timeoutMs,
				onResponse: (res) => {
					const status = res.statusCode ?? 0
					if (status >= 300 && status < 400) {
						const location = res.headers.location
						res.resume()
						if (location === undefined || Array.isArray(location)) {
							reject(
								pluginAssetError(
									"POLICY",
									"plugin download redirect without a Location header",
								),
							)
							return
						}
						resolve({ kind: "redirect", location })
						return
					}
					if (status < 200 || status >= 300) {
						res.resume()
						reject(
							new Error(`plugin download returned HTTP ${status}: ${url.href}`),
						)
						return
					}
					let seen = 0
					const limiter = new Transform({
						transform(chunk: Buffer, _enc, cb) {
							seen += chunk.length
							if (seen > deps.maxBytes) {
								cb(
									pluginAssetError(
										"POLICY",
										`plugin download exceeded the ${deps.maxBytes}-byte cap: ${url.href}`,
									),
								)
								return
							}
							cb(null, chunk)
						},
					})
					pipeline(res, limiter, createWriteStream(targetPath))
						.then(async () => {
							resolve({
								kind: "done",
								sizeBytes: seen,
								sha256: await hashFile(targetPath),
							})
						})
						.catch((err) => {
							req.destroy()
							reject(err)
						})
				},
			})
			req.on("error", reject)
		})
	}

	function requestUrl(
		url: URL,
		opts: {
			readonly method: "GET" | "HEAD"
			readonly timeoutMs: number
			readonly onResponse: (res: http.IncomingMessage) => void
		},
	): http.ClientRequest {
		const client = url.protocol === "https:" ? https : http
		const req = client.request(
			url,
			{
				method: opts.method,
				// Pin the socket to a vetted public address (or any address
				// when private ranges are allowed) — the resolve-time policy
				// check and the actual connect share one lookup.
				lookup: pinnedLookup,
				headers: {
					Accept: "*/*",
					"Accept-Encoding": "identity",
				},
			},
			opts.onResponse,
		)
		req.setTimeout(opts.timeoutMs, () => {
			req.destroy(new Error(`plugin download timed out: ${url.href}`))
		})
		req.end()
		return req
	}

	function pinnedLookup(
		hostname: string,
		_options: unknown,
		callback: (err: Error | null, address: string, family: number) => void,
	): void {
		dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
			if (err !== null && err !== undefined) {
				callback(err, "", 4)
				return
			}
			const chosen = (addresses ?? []).find((a) =>
				deps.allowPrivate ? true : isPublicAddress(a.address),
			)
			if (chosen === undefined) {
				callback(
					new Error(
						`plugin download address is not public: ${hostname} — enable PLUGIN_DOWNLOAD_ALLOW_PRIVATE to allow private ranges`,
					),
					"",
					4,
				)
				return
			}
			callback(null, chosen.address, chosen.family)
		})
	}

	return { vetUrl, fetchToFile, probeSize }
}

/** True for a globally routable address (IPv4/IPv6). */
function isPublicAddress(address: string): boolean {
	const family = isIP(address)
	if (family === 4) {
		const parts = address.split(".")
		const a = Number(parts[0])
		const b = Number(parts[1])
		if (a === 0 || a === 10 || a === 127) return false
		if (a === 169 && b === 254) return false
		if (a === 172 && Number.isFinite(b) && b >= 16 && b <= 31) return false
		if (a === 192 && b === 168) return false
		// CGNAT (100.64.0.0/10), documentation (192.0.2/24, 198.51.100/24,
		// 203.0.113/24) and benchmarking (198.18.0.0/15) ranges are not
		// globally routable — block them like the private ones.
		if (a === 100 && Number.isFinite(b) && b >= 64 && b <= 127) return false
		if (a === 192 && b === 0 && parts[2] === "2") return false
		if (a === 198 && (b === 18 || b === 19)) return false
		if (a === 198 && b === 51 && parts[2] === "100") return false
		if (a === 203 && b === 0 && parts[2] === "113") return false
		if (a >= 224) return false
		return true
	}
	if (family === 6) {
		const lower = address.toLowerCase()
		if (lower === "::" || lower === "::1") return false
		// IPv4-mapped IPv6: decode the enclosed v4 address and re-check.
		if (lower.startsWith("::ffff:")) {
			return isPublicAddress(lower.slice("::ffff:".length))
		}
		// fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
		if (lower.startsWith("fc") || lower.startsWith("fd")) return false
		if (
			lower.startsWith("fe8") ||
			lower.startsWith("fe9") ||
			lower.startsWith("fea") ||
			lower.startsWith("feb")
		) {
			return false
		}
		// 2001:db8::/32 documentation range — not globally routable.
		if (lower.startsWith("2001:db8:")) return false
		if (lower.startsWith("ff")) return false
		return true
	}
	return false
}

async function hashFile(path: string): Promise<string> {
	const hash = createHash("sha256")
	const { createReadStream } = await import("node:fs")
	await new Promise<void>((resolveDone, reject) => {
		const stream = createReadStream(path)
		stream.on("data", (chunk: string | Buffer) => hash.update(chunk))
		stream.on("end", () => resolveDone())
		stream.on("error", reject)
	})
	return hash.digest("hex")
}
