/**
 * App-wide outbound proxy resolution. One resolver, one bypass matcher,
 * one agent store — every Node-side network service (the plugin
 * downloader, the marketplace, desktop update fetches) consumes the same
 * {@link ProxyConfig}.
 *
 * Resolution order:
 * 1. `HOARDODILE_PROXY` (explicit override; `off` disables proxying
 *    entirely, overriding everything below);
 * 2. standard proxy env vars (`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`,
 *    lowercase variants included, per target protocol);
 * 3. the OS system proxy (Windows `reg query` Internet Settings, macOS
 *    `scutil --proxy`); Linux desktops only expose env vars.
 *
 * Only `http://` proxies are supported (the local Clash/V2rayN style).
 * Bypass entries come from `NO_PROXY`/`no_proxy` plus the OS override
 * list; loopback hosts are always fetched directly. Credentials embedded
 * in the proxy URL are forwarded as `Proxy-Authorization` by the agents.
 */
import { spawnSync } from "node:child_process"
import type http from "node:http"
import { isIP } from "node:net"
import { HttpProxyAgent } from "http-proxy-agent"
import { HttpsProxyAgent } from "https-proxy-agent"

/** Explicit app-level override env var (takes priority over everything). */
export const PROXY_OVERRIDE_ENV = "HOARDODILE_PROXY"
/** Value of {@link PROXY_OVERRIDE_ENV} that turns proxy use off. */
export const PROXY_OFF_TOKEN = "off"

/**
 * GitHub hosts the app is allowed to reach for plugin assets. The
 * marketplace install endpoint re-validates against this set.
 */
export const GITHUB_ASSET_HOSTS: ReadonlySet<string> = new Set([
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
])

/**
 * GitHub hosts that may be fetched through a proxy even when local DNS
 * is unusable (DNS-blocked regions, Clash fake-IP): the proxy does the
 * resolution and TLS still pins the certificate to the hostname.
 */
export const TRUSTED_GITHUB_HOSTS: ReadonlySet<string> = new Set([
	...GITHUB_ASSET_HOSTS,
	"raw.githubusercontent.com",
	"api.github.com",
])

export type ProxySource = "explicit" | "env" | "system" | "none"

export type ProxyConfig = {
	/** Proxy for `http:` targets (absolute-form). */
	readonly http: URL | null
	/** Proxy for `https:` targets (CONNECT tunnel). */
	readonly https: URL | null
	/** Bypass entries (NO_PROXY + system override list, merged). */
	readonly bypass: readonly string[]
	/** Where the config came from — for logs and diagnostics. */
	readonly source: ProxySource
}

/**
 * Raw OS system-proxy output, read once and parsed by the pure parsers
 * below (injectable so tests never touch `reg`/`scutil`).
 */
export type SystemProxySnapshot = {
	readonly platform: "win32" | "darwin"
	readonly raw: string
}

export type ProxyEnv = Readonly<Record<string, string | undefined>>

const BYPASS_ENV_NAMES = ["NO_PROXY", "no_proxy"] as const

function parseProxyUrl(rawValue: string, label: string): URL {
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue)
		? rawValue
		: `http://${rawValue}`
	let url: URL
	try {
		url = new URL(withScheme)
	} catch {
		throw new Error(`${label} is not a valid URL: ${rawValue}`)
	}
	if (url.protocol !== "http:") {
		throw new Error(
			`${label} must use http:// (got ${url.protocol}//) — only http proxies are supported`,
		)
	}
	if (url.pathname !== "" && url.pathname !== "/") {
		throw new Error(`${label} must not contain a path (got ${url.pathname})`)
	}
	url.pathname = ""
	url.search = ""
	url.hash = ""
	return url
}

/**
 * Resolve the app-wide proxy config from env + the OS. Pure apart from
 * the (injectable) system reader; safe to call at boot.
 */
export function resolveProxyConfig(
	env: ProxyEnv,
	platform: string,
	readSystem?: () => SystemProxySnapshot | null,
): ProxyConfig {
	const explicit = (env[PROXY_OVERRIDE_ENV] ?? "").trim()
	if (explicit.length > 0) {
		if (explicit.toLowerCase() === PROXY_OFF_TOKEN) {
			return { http: null, https: null, bypass: [], source: "none" }
		}
		const url = parseProxyUrl(explicit, PROXY_OVERRIDE_ENV)
		return { http: url, https: url, bypass: envBypass(env), source: "explicit" }
	}

	const system = readSystem?.() ?? defaultSystemSnapshot(platform)
	const systemEntries =
		system !== null
			? systemProxySource(system)
			: { http: null, https: null, bypass: [] as readonly string[] }

	const httpsUrl = firstValidEnvProxy(env, [
		"HTTPS_PROXY",
		"https_proxy",
		"ALL_PROXY",
		"all_proxy",
	])
	const httpUrl = firstValidEnvProxy(env, [
		"HTTP_PROXY",
		"http_proxy",
		"ALL_PROXY",
		"all_proxy",
	])
	if (httpsUrl !== null || httpUrl !== null) {
		return {
			http: httpUrl,
			https: httpsUrl,
			bypass: [...envBypass(env), ...systemEntries.bypass],
			source: "env",
		}
	}

	if (systemEntries.http !== null || systemEntries.https !== null) {
		return {
			http: systemEntries.http,
			https: systemEntries.https,
			bypass: [...envBypass(env), ...systemEntries.bypass],
			source: "system",
		}
	}

	return { http: null, https: null, bypass: envBypass(env), source: "none" }
}

function firstValidEnvProxy(
	env: ProxyEnv,
	names: readonly string[],
): URL | null {
	for (const name of names) {
		const value = (env[name] ?? "").trim()
		if (value.length === 0) continue
		try {
			return parseProxyUrl(value, name)
		} catch {
			// A malformed/mismatched proxy env must never break the app —
			// skip it and try the next source.
		}
	}
	return null
}

function envBypass(env: ProxyEnv): string[] {
	const entries: string[] = []
	for (const name of BYPASS_ENV_NAMES) {
		if (env[name] !== undefined && env[name] !== "") {
			entries.push(...splitBypassList(env[name]!))
		}
	}
	return entries
}

function splitBypassList(raw: string): string[] {
	return raw
		.split(/[\s,;]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

function systemProxySource(snapshot: SystemProxySnapshot): SystemProxyEntries {
	return snapshot.platform === "win32"
		? parseWindowsProxyOutput(snapshot.raw)
		: parseMacScutilOutput(snapshot.raw)
}

/**
 * The OS proxy snapshot as raw text: Windows `reg query` (Internet
 * Settings) or macOS `scutil --proxy`. Returns `null` when there is no
 * such source on this platform (or it cannot be read).
 */
export function defaultSystemSnapshot(
	platform: string,
): SystemProxySnapshot | null {
	if (platform === "win32") {
		const out = spawnSync(
			"reg",
			[
				"query",
				"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
			],
			{ encoding: "utf8", timeout: 2_000, windowsHide: true },
		)
		if (out.status !== 0) return null
		return { platform: "win32", raw: out.stdout ?? "" }
	}
	if (platform === "darwin") {
		const out = spawnSync("scutil", ["--proxy"], {
			encoding: "utf8",
			timeout: 2_000,
		})
		if (out.status !== 0) return null
		return { platform: "darwin", raw: out.stdout ?? "" }
	}
	return null
}

export type SystemProxyEntries = {
	readonly http: URL | null
	readonly https: URL | null
	readonly bypass: readonly string[]
}

/**
 * Parse Windows `reg query … Internet Settings` output. `ProxyServer`
 * accepts `host:port` (both protocols) or the per-protocol
 * `http=host:port;https=host:port` map; `ProxyOverride` (semicolon
 * separated, `<local>` = hosts without a dot) becomes the bypass list.
 */
export function parseWindowsProxyOutput(raw: string): SystemProxyEntries {
	let enabled = false
	let server = ""
	let override = ""
	for (const line of raw.split(/\r?\n/)) {
		const match = line.match(
			/^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.*?)\s*$/,
		)
		if (match === null) continue
		if (match[1] === "ProxyEnable") enabled = match[2]!.trim() === "0x1"
		if (match[1] === "ProxyServer") server = match[2]!.trim()
		if (match[1] === "ProxyOverride") override = match[2]!.trim()
	}
	if (!enabled || server.length === 0) {
		return { http: null, https: null, bypass: splitBypassList(override) }
	}
	const perProtocol = new Map<string, string>()
	let fallback: string | undefined
	for (const entry of server.split(";")) {
		const eq = entry.indexOf("=")
		if (eq === -1) {
			fallback = entry.trim()
		} else {
			perProtocol.set(entry.slice(0, eq).trim(), entry.slice(eq + 1).trim())
		}
	}
	const toUrl = (rawValue: string): URL =>
		parseProxyUrl(`${rawValue}`, "ProxyServer")
	const http = perProtocol.get("http") ?? fallback
	const https = perProtocol.get("https") ?? fallback
	return {
		http: http !== undefined && http.length > 0 ? toUrl(http) : null,
		https: https !== undefined && https.length > 0 ? toUrl(https) : null,
		bypass: splitBypassList(override),
	}
}

/**
 * Parse macOS `scutil --proxy` output into per-protocol proxies plus the
 * `ExceptionsList` (which separates entries with `*` globs and `<local>`).
 */
export function parseMacScutilOutput(raw: string): SystemProxyEntries {
	const dict = new Map<string, string>()
	for (const line of raw.split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.*?)\s*$/)
		if (match === null) continue
		dict.set(match[1]!, match[2]!)
	}
	const bypass: string[] = []
	// ExceptionsList : <array> { 0 : "*.local" … }
	const exceptionsHeader = raw.match(/ExceptionsList\s*:\s*<array>/)
	if (exceptionsHeader !== null) {
		const after = raw.slice(
			(exceptionsHeader.index ?? 0) + exceptionsHeader[0].length,
		)
		const entries = after.matchAll(/^\s*(\d+)\s*:\s*(.+?)\s*$/gm)
		for (const entry of entries) {
			bypass.push(entry[2]!.trim().replace(/^"|"$/g, ""))
		}
	}
	const address = (
		enableKey: string,
		hostKey: string,
		portKey: string,
	): URL | null => {
		if (dict.get(enableKey) !== "1") return null
		const host = dict.get(hostKey)?.trim()
		if (host === undefined || host.length === 0) return null
		const port = dict.get(portKey)?.trim() ?? ""
		return parseProxyUrl(
			`${host}${port.length > 0 ? `:${port}` : ""}`,
			"scutil",
		)
	}
	return {
		http: address("HTTPEnable", "HTTPProxy", "HTTPPort"),
		https: address("HTTPSEnable", "HTTPSProxy", "HTTPSPort"),
		bypass,
	}
}

/**
 * The proxy for `target`, or `null` when it must be fetched directly
 * (loopback hosts, bypass entries — or no proxy configured for the
 * target protocol).
 */
export function proxyFor(target: URL, config: ProxyConfig): URL | null {
	const host = normalizeHost(target.hostname)
	if (isLoopbackHost(host)) return null
	if (bypassMatches(host, config.bypass)) return null
	if (target.protocol === "https:") return config.https
	if (target.protocol === "http:") return config.http
	return null
}

function normalizeHost(hostname: string): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
}

function isLoopbackHost(host: string): boolean {
	return (
		host === "localhost" ||
		host === "0.0.0.0" ||
		host === "::1" ||
		host.startsWith("127.")
	)
}

/**
 * NO_PROXY-style matching: `*` (everything), `<local>` (hosts without a
 * dot), `*.example.com` / `.example.com` (suffix), `127.*` segment globs,
 * or an exact host — a plain entry also matches its subdomains (curl
 * semantics). Case-insensitive; leading/trailing spaces ignored.
 */
export function bypassMatches(
	hostname: string,
	entries: readonly string[],
): boolean {
	const host = normalizeHost(hostname)
	for (const entry of entries) {
		if (matchesBypassEntry(host, entry)) return true
	}
	return false
}

function matchesBypassEntry(host: string, rawEntry: string): boolean {
	let entry = rawEntry.trim().toLowerCase()
	if (entry.length === 0) return false
	if (entry === "*") return true
	if (entry === "<local>") return !host.includes(".")
	// Strip a trailing `:port` before matching.
	const portIdx = entry.lastIndexOf(":")
	if (portIdx > 0 && /^\d+$/.test(entry.slice(portIdx + 1))) {
		entry = entry.slice(0, portIdx)
	}
	if (entry.startsWith("*.")) {
		entry = entry.slice(1)
	}
	if (entry.startsWith(".")) {
		const suffix = entry.slice(1)
		return host === suffix || host.endsWith(`.${suffix}`)
	}
	if (entry.includes("*")) {
		const re = new RegExp(`^${entry.split("*").map(escapeRegExp).join(".*")}$`)
		return re.test(host)
	}
	return host === entry || host.endsWith(`.${entry}`)
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const agentCache = new Map<string, http.Agent>()

/**
 * Cached per-(proxy URL, protocol) agent. `https:` targets get a
 * CONNECT-tunnel agent, `http:` targets an absolute-form agent; the
 * agent parses credentials out of the proxy URL and sends
 * `Proxy-Authorization` itself.
 */
export function proxyAgentFor(
	proxyUrl: URL,
	targetProtocol: "http" | "https",
): http.Agent {
	const key = `${proxyUrl.href}|${targetProtocol}`
	let agent = agentCache.get(key)
	if (agent === undefined) {
		agent =
			targetProtocol === "https"
				? new HttpsProxyAgent(proxyUrl.href)
				: new HttpProxyAgent(proxyUrl.href)
		agentCache.set(key, agent)
	}
	return agent
}

/**
 * True for a globally routable address (IPv4/IPv6). Private, loopback,
 * link-local, CGNAT, documentation, benchmarking and multicast ranges
 * return false; IPv4-mapped IPv6 is decoded first.
 */
export function isPublicAddress(address: string): boolean {
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

/**
 * May `hostname` be fetched through a user proxy, given the addresses
 * the local resolver returned (empty when resolution failed)? A locally
 * public address always passes; a failed / non-public resolution only
 * passes for the trusted GitHub hosts — the proxy resolves those and
 * TLS still pins the certificate, while everything else keeps the
 * "not public" rejection so a proxy can never reach private ranges.
 */
export function proxyTargetAllowed(
	hostname: string,
	resolvedAddresses: readonly string[],
): boolean {
	if (resolvedAddresses.some(isPublicAddress)) return true
	return TRUSTED_GITHUB_HOSTS.has(hostname)
}

/**
 * Electron `session.setProxy` rules mirroring the config. Returns `null`
 * when there is nothing to route. Credentials are deliberately omitted
 * (Chromium proxy-rule credentials are not supported by setProxy; an
 * authenticated local proxy either answers 407 with a prompt or is
 * configured without auth).
 */
export function toProxyRules(config: ProxyConfig): {
	readonly proxyRules: string
	readonly proxyBypassRules: string
} | null {
	if (config.http === null && config.https === null) return null
	const rules: string[] = []
	if (config.http !== null) rules.push(`http=${config.http.host}`)
	if (config.https !== null) rules.push(`https=${config.https.host}`)
	return {
		proxyRules: rules.join(";"),
		proxyBypassRules: [...config.bypass, "<local>"].join(","),
	}
}

/** One-line description for boot logs ("system via 127.0.0.1:7897"). */
export function describeProxy(config: ProxyConfig): string {
	if (config.source === "none") return "off (direct)"
	const target = config.https ?? config.http
	const host = target !== null ? target.host : ""
	return `${config.source} proxy${host.length > 0 ? ` ${host}` : ""}`
}
