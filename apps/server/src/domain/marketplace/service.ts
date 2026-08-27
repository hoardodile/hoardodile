import { randomUUID } from "node:crypto"
import {
	createReadStream,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { mkdir, readFile, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { PluginManifest } from "@hoardodile/sdk-types"
import { pluginManifest } from "@hoardodile/sdk-types/schema"
import { invalid } from "@hoardodile/shared"
import { GITHUB_ASSET_HOSTS } from "@hoardodile/shared/net-proxy"
import {
	type ConcurrencyLimiter,
	createConcurrencyLimiter,
} from "src/infra/concurrency-limiter.ts"
import {
	DEFAULT_MARKETPLACE_REPO,
	githubReleasePayload,
	MARKETPLACE_PREF_KEY,
	type MarketError,
	type MarketInstallInput,
	type MarketLatest,
	type MarketPlugin,
	type MarketSnapshot,
	marketRegistryFile,
} from "./schema.ts"

/**
 * The plugin marketplace: a registry repo (a `registry.json` listing
 * plugin repository addresses) plus per-plugin GitHub metadata served
 * straight from each repo — everything the UI shows is fetched, the
 * registry only carries the addresses.
 *
 * Data channels, by cost:
 * - registry file + each plugin's `manifest.json`: `raw.githubusercontent.com`
 *   (no API quota; ref fallback `HEAD` → `main` → `master`);
 * - latest release info: `api.github.com/repos/<repo>/releases/latest`
 *   (the only API-quota-hungry call, one per plugin);
 * - install/update assets: the release's `browser_download_url`
 *   (a direct `github.com` download, no API quota).
 *
 * All fetching goes through the app's hardened HTTP client — the same
 * policy (public-address pinning, redirect re-vetting, byte caps) the
 * plugin vault downloads use.
 */

const CACHE_TTL_MS = 10 * 60_000
/**
 * How long one repo's `releases/latest` payload is trusted. The API is
 * the ONLY quota-hungry call (60/hour unauthenticated per IP), so the
 * release layer is cached independently from the snapshot layer (whose
 * registry/manifest fetches are raw URLs, no quota).
 */
const RELEASE_CACHE_TTL_MS = 60 * 60_000
/** After a GitHub 403/429, skip the API for this long per repo. */
const RATE_LIMIT_COOLDOWN_MS = 60 * 60_000
const MAX_RAW_BYTES = 512 * 1024
const MAX_API_BYTES = 2 * 1024 * 1024
const MAX_SHA256_BYTES = 8 * 1024
const MAX_INTRO_BYTES = 256 * 1024
/** Release-body cap for the dedicated Release notes tab (still bounded by the payload cap). */
const NOTES_MAX_LENGTH = 128_000
const REFS = ["HEAD", "main", "master"] as const
const API_FETCH_CONCURRENCY = 5
const USER_AGENT = "hoardodile-plugin-marketplace"
/** Release-asset names for the author-published intro: `intro.<locale>.md`. */
const INTRO_ASSET_RE = /^intro\.([A-Za-z0-9-]{1,20})\.md$/

/**
 * Hosts a marketplace install URL may land on. `github.com` is the
 * canonical release download host; the other two are the redirect
 * targets GitHub serves release assets from. Every redirect hop is
 * re-vetted by the underlying downloader (public addresses only).
 */
const ASSET_HOSTS = GITHUB_ASSET_HOSTS

/**
 * Narrow structural view of the app's HTTP client. Satisfied by the real
 * `PluginDownloader` — the marketplace declares only what it uses so the
 * plugin domain stays unimported.
 */
type MarketplaceFetcher = {
	readonly fetchToFile: (
		url: string,
		targetPath: string,
		opts?: {
			readonly headers?: Readonly<Record<string, string>>
			readonly maxBytes?: number
		},
	) => Promise<{ readonly sizeBytes: number; readonly sha256: string }>
}

/** Narrow structural view of the plugin installer (`PluginUploads`). */
type MarketplaceInstaller = {
	readonly installFromZip: (
		archive: NodeJS.ReadableStream,
		opts?: { readonly expectedId?: string },
	) => Promise<string>
}

/** Narrow structural view of the system preference service. */
type MarketplacePrefs = {
	get(key: string): { readonly key: string; readonly value: string } | undefined
	set(
		key: string,
		value: string,
	): { readonly key: string; readonly value: string }
	remove(key: string): void
}

export type MarketplaceServiceDeps = {
	readonly prefs: MarketplacePrefs
	readonly fetcher: MarketplaceFetcher
	readonly installer: MarketplaceInstaller
	readonly rescan: () => Promise<void>
	/** Temp directory for downloaded registries/manifests/install zips. */
	readonly tmpDir: string
	/** Byte cap for one install download (mirrors the plugin upload cap). */
	readonly maxInstallBytes: number
	/**
	 * Persistent release-cache file (`local/cache/marketplace-releases.json`).
	 * Survives server restarts so the quota-hungry GitHub API is asked at
	 * most once per repo per hour.
	 */
	readonly releaseCacheFile: string
	readonly now?: () => number
}

export type MarketplaceService = {
	/**
	 * Configured registry repo, the built-in default registry, or
	 * `null` when the marketplace is explicitly disabled.
	 */
	getConfig(): { readonly registryRepo: string | null }
	/** `null` disables the marketplace and clears the cache. */
	setConfig(registryRepo: string | null): void
	/**
	 * Snapshot of the curated marketplace. Served from a 10-minute
	 * in-memory cache unless `force` (the "refresh now" button); a single
	 * in-flight refresh is shared by concurrent callers.
	 */
	refresh(force: boolean): Promise<MarketSnapshot>
	/** Download + validate + install a release asset (install or update). */
	install(input: MarketInstallInput): Promise<{ readonly pluginId: string }>
}

type MarketFetchErrorKind = "missing" | "rate_limited" | "failed"

class MarketFetchError extends Error {
	readonly kind: MarketFetchErrorKind
	constructor(kind: MarketFetchErrorKind, message: string) {
		super(message)
		this.name = "MarketFetchError"
		this.kind = kind
	}
}

type GithubAsset = {
	readonly name: string
	readonly browser_download_url: string
}

/** Disk/memory shape of one repo's cached latest release payload. */
type ReleaseCacheEntry = {
	readonly latest?: MarketLatest
	readonly fetchedAt?: number
	readonly rateLimitedUntil?: number
}

/** Structural acceptance for one persisted cache entry — invalid entries
    are skipped, a fully invalid file starts the cache empty. */
function parseReleaseCacheEntry(value: unknown): ReleaseCacheEntry | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const entry = value as Record<string, unknown>
	const latest = entry.latest
	if (
		typeof latest === "object" &&
		latest !== null &&
		typeof (latest as Record<string, unknown>).version === "string" &&
		typeof (latest as Record<string, unknown>).tag === "string"
	) {
		const fetchedAt =
			typeof entry.fetchedAt === "number" ? entry.fetchedAt : undefined
		const rateLimitedUntil =
			typeof entry.rateLimitedUntil === "number"
				? entry.rateLimitedUntil
				: undefined
		return {
			latest: latest as unknown as MarketLatest,
			...(fetchedAt !== undefined ? { fetchedAt } : {}),
			...(rateLimitedUntil !== undefined ? { rateLimitedUntil } : {}),
		}
	}
	// Marker-only entry ({ rateLimitedUntil }) is still loadable.
	if (typeof entry.rateLimitedUntil !== "number") return undefined
	return { rateLimitedUntil: entry.rateLimitedUntil }
}

export function createMarketplaceService(
	deps: MarketplaceServiceDeps,
): MarketplaceService {
	const {
		prefs,
		fetcher,
		installer,
		tmpDir,
		maxInstallBytes,
		releaseCacheFile,
	} = deps
	const now = deps.now ?? Date.now
	const limiter: ConcurrencyLimiter = createConcurrencyLimiter(
		API_FETCH_CONCURRENCY,
	)

	const cache = new Map<
		string,
		{ readonly snapshot: MarketSnapshot; readonly fetchedAt: number }
	>()
	let pending: Promise<MarketSnapshot> | undefined

	/** One repo's latest release payload, with its cooldown marker. */
	const releaseCache = new Map<string, ReleaseCacheEntry>()
	let releaseCacheLoaded = false
	let releaseCacheDirty = false

	function loadReleaseCache(): void {
		if (releaseCacheLoaded) return
		releaseCacheLoaded = true
		try {
			const parsed: unknown = JSON.parse(
				readFileSync(releaseCacheFile, "utf-8"),
			)
			if (typeof parsed !== "object" || parsed === null) return
			const entries = (parsed as { entries?: unknown }).entries
			if (typeof entries !== "object" || entries === null) return
			for (const [repo, value] of Object.entries(
				entries as Record<string, unknown>,
			)) {
				const entry = parseReleaseCacheEntry(value)
				if (entry !== undefined) releaseCache.set(repo, entry)
			}
		} catch {
			// Missing or corrupt cache — start empty.
		}
	}

	function persistReleaseCache(): void {
		if (!releaseCacheDirty) return
		releaseCacheDirty = false
		try {
			const entries: Record<string, unknown> = {}
			for (const [repo, entry] of releaseCache) {
				entries[repo] = {
					...(entry.latest !== undefined ? { latest: entry.latest } : {}),
					...(entry.fetchedAt !== undefined
						? { fetchedAt: entry.fetchedAt }
						: {}),
					...(entry.rateLimitedUntil !== undefined
						? { rateLimitedUntil: entry.rateLimitedUntil }
						: {}),
				}
			}
			mkdirSync(dirname(releaseCacheFile), { recursive: true })
			writeFileSync(
				releaseCacheFile,
				JSON.stringify({ version: 1, entries: entries }, null, "\t"),
			)
		} catch {
			// Cache persistence is best-effort — never fail the catalog.
		}
	}

	function markReleaseCacheDirty(): void {
		releaseCacheDirty = true
	}

	function getConfig(): { readonly registryRepo: string | null } {
		const value = prefs.get(MARKETPLACE_PREF_KEY)?.value
		return {
			registryRepo:
				value === undefined
					? DEFAULT_MARKETPLACE_REPO
					: value.length === 0
						? null
						: value,
		}
	}

	function setConfig(registryRepo: string | null): void {
		if (registryRepo === null) {
			// A `""` sentinel keeps "disabled" distinct from "never
			// configured", which means the built-in default registry.
			prefs.set(MARKETPLACE_PREF_KEY, "")
			cache.clear()
			return
		}
		prefs.set(MARKETPLACE_PREF_KEY, normalizeRepoAddress(registryRepo))
	}

	async function refresh(force: boolean): Promise<MarketSnapshot> {
		const repo = currentRepo()
		if (!force) {
			const cached = cache.get(repo)
			if (cached !== undefined && now() - cached.fetchedAt < CACHE_TTL_MS) {
				return cached.snapshot
			}
		}
		if (pending !== undefined) return await pending
		pending = buildAndCache(repo, force).finally(() => {
			pending = undefined
		})
		return await pending
	}

	async function install(
		input: MarketInstallInput,
	): Promise<{ readonly pluginId: string }> {
		assertAssetHost(input.assetUrl)
		await mkdir(tmpDir, { recursive: true })
		const target = join(tmpDir, `marketplace-install-${randomUUID()}.zip`)
		let result: { readonly sha256: string }
		try {
			result = await fetcher.fetchToFile(input.assetUrl, target, {
				maxBytes: maxInstallBytes,
			})
		} catch (err) {
			throw invalid(
				"marketplace.asset_download_failed",
				`plugin asset download failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
		try {
			if (
				input.sha256 !== undefined &&
				input.sha256.toLowerCase() !== result.sha256
			) {
				throw invalid(
					"marketplace.asset_sha256_mismatch",
					"plugin asset checksum does not match the published sha256",
					{ expected: input.sha256, actual: result.sha256 },
				)
			}
			const pluginId = await installer.installFromZip(
				createReadStream(target),
				{ expectedId: input.id },
			)
			await deps.rescan()
			return { pluginId }
		} finally {
			await rm(target, { force: true }).catch(() => {})
		}
	}

	function currentRepo(): string {
		const repo = prefs.get(MARKETPLACE_PREF_KEY)?.value
		if (repo === undefined) {
			// Never configured: the built-in default registry.
			return DEFAULT_MARKETPLACE_REPO
		}
		if (repo.length === 0) {
			throw invalid(
				"marketplace.not_configured",
				"plugin marketplace is not configured — set a registry repo first",
			)
		}
		return repo
	}

	async function buildAndCache(
		repo: string,
		force: boolean,
	): Promise<MarketSnapshot> {
		const snapshot = await buildSnapshot(repo, force)
		cache.set(repo, { snapshot, fetchedAt: snapshot.fetchedAt })
		return snapshot
	}

	async function buildSnapshot(
		repo: string,
		force: boolean,
	): Promise<MarketSnapshot> {
		let registryText: string
		try {
			registryText = await fetchTextBestEffort(rawUrls(repo, "registry.json"), {
				maxBytes: MAX_RAW_BYTES,
			})
		} catch (err) {
			throw registryErrorFor(err, repo)
		}

		let registry: unknown
		try {
			registry = JSON.parse(registryText) as unknown
		} catch {
			throw invalid(
				"marketplace.registry_invalid",
				"registry.json is not valid JSON",
			)
		}
		const file = marketRegistryFile.safeParse(registry)
		if (!file.success) {
			throw invalid(
				"marketplace.registry_invalid",
				"registry.json failed validation",
				{ issues: file.error.issues },
			)
		}

		const entries = file.data.plugins.map((raw, index) => {
			try {
				return normalizeRepoAddress(raw)
			} catch {
				throw invalid(
					"marketplace.registry_entry_invalid",
					`registry.json plugins[${index}] is not a GitHub repository address`,
					{ value: raw },
				)
			}
		})

		const results = await Promise.all(
			entries.map((entry) => limiter.run(() => loadPlugin(entry, force))),
		)
		const plugins: MarketPlugin[] = []
		const errors: MarketError[] = []
		for (const result of results) {
			if (result.kind === "error") {
				errors.push({ repo: result.repo, message: result.message })
			} else {
				plugins.push(result.plugin)
			}
		}
		persistReleaseCache()
		return {
			registryRepo: repo,
			fetchedAt: now(),
			plugins,
			errors,
		}
	}

	async function loadPlugin(
		repo: string,
		force: boolean,
	): Promise<
		| { readonly kind: "plugin"; readonly plugin: MarketPlugin }
		| {
				readonly kind: "error"
				readonly repo: string
				readonly message: string
		  }
	> {
		let manifest: PluginManifest
		try {
			const text = await fetchTextBestEffort(rawUrls(repo, "manifest.json"), {
				maxBytes: MAX_RAW_BYTES,
			})
			let parsed: unknown
			try {
				parsed = JSON.parse(text) as unknown
			} catch {
				return {
					kind: "error",
					repo,
					message: "manifest.json is not valid JSON",
				}
			}
			const result = pluginManifest.safeParse(parsed)
			if (!result.success) {
				return {
					kind: "error",
					repo,
					message: "manifest.json failed validation",
				}
			}
			manifest = result.data
		} catch (err) {
			if (err instanceof MarketFetchError && err.kind === "missing") {
				return {
					kind: "error",
					repo,
					message:
						"no manifest.json at the repo root — is this a plugin repository?",
				}
			}
			return {
				kind: "error",
				repo,
				message: fetchFailureMessage(err, "manifest.json"),
			}
		}

		const base: Omit<MarketPlugin, "state" | "latest" | "error"> = {
			id: manifest.id,
			repo,
			name: manifest.name,
			description: manifest.description,
			icon: manifest.icon,
			permissions: manifest.permissions,
			manifest,
		}

		let latest: MarketLatest | undefined
		let degraded = false
		let failure: string | undefined
		let failureKind: "rate_limited" | "failed" | "missing" | undefined
		try {
			const result = await loadLatest(repo, manifest, force)
			latest = result.latest
			degraded = result.degraded
		} catch (err) {
			if (err instanceof MarketFetchError && err.kind === "missing") {
				// 404 from `releases/latest` = a manifest-bearing repo that
				// has simply not published anything yet.
				return {
					kind: "plugin",
					plugin: {
						...base,
						state: "no_release",
						latest: undefined,
						error: undefined,
					},
				}
			}
			failure = fetchFailureMessage(err, "latest release")
			failureKind = err instanceof MarketFetchError ? err.kind : "failed"
		}

		if (failure !== undefined) {
			return {
				kind: "plugin",
				plugin: {
					...base,
					state: "error",
					latest: undefined,
					error: failure,
					...(failureKind !== undefined ? { errorKind: failureKind } : {}),
				},
			}
		}
		return {
			kind: "plugin",
			plugin: {
				...base,
				state: "ok",
				latest,
				error: undefined,
				...(degraded ? { rateLimited: true } : {}),
			},
		}
	}

	/** Cached release payload plus whether it was served degraded. */
	type ReleaseLoadResult = {
		readonly latest: MarketLatest
		/** True when the rate limit forced a stale-cache reuse. */
		readonly degraded: boolean
	}

	/**
	 * One repo's latest release — cached per repo for an hour (and
	 * persisted to disk) because the GitHub API call is the only
	 * quota-hungry fetch. A rate-limited API degrades to the stale cached
	 * payload instead of erroring (flagged as degraded); the cooldown
	 * marker suppresses further API attempts for the hour.
	 *
	 * The manual "refresh now" passes `bypass = true`: it re-checks the
	 * API regardless of the one-hour TTL (the whole catalog refreshes,
	 * including release info), but still respects the rate-limit cooldown
	 * and degrades to cached data on any other failure.
	 */
	async function loadLatest(
		repo: string,
		manifest: PluginManifest,
		bypass: boolean,
	): Promise<ReleaseLoadResult> {
		loadReleaseCache()
		const cached = releaseCache.get(repo)
		if (
			!bypass &&
			cached?.latest !== undefined &&
			cached.fetchedAt !== undefined &&
			cached.rateLimitedUntil === undefined &&
			now() - cached.fetchedAt < RELEASE_CACHE_TTL_MS
		) {
			return { latest: cached.latest, degraded: false }
		}
		const cooldownActive =
			cached?.rateLimitedUntil !== undefined && cached.rateLimitedUntil > now()

		if (!cooldownActive) {
			try {
				const latest = await fetchRelease(repo, manifest)
				releaseCache.set(repo, { latest, fetchedAt: now() })
				markReleaseCacheDirty()
				return { latest, degraded: false }
			} catch (err) {
				if (err instanceof MarketFetchError && err.kind === "rate_limited") {
					releaseCache.set(repo, {
						...(cached !== undefined ? { ...cached } : {}),
						rateLimitedUntil: now() + RATE_LIMIT_COOLDOWN_MS,
					})
					markReleaseCacheDirty()
					if (cached?.latest !== undefined) {
						return { latest: cached.latest, degraded: true }
					}
				} else if (bypass && cached?.latest !== undefined) {
					// A forced refresh that fails keeps serving the cached
					// payload rather than dropping the entry.
					return { latest: cached.latest, degraded: false }
				}
				throw err
			}
		}

		if (cached?.latest !== undefined) {
			return { latest: cached.latest, degraded: true }
		}
		throw new MarketFetchError(
			"rate_limited",
			"GitHub API rate limit hit — no cached release data yet",
		)
	}

	async function fetchRelease(
		repo: string,
		manifest: PluginManifest,
	): Promise<MarketLatest> {
		const raw = await fetchTextBestEffort([apiReleaseUrl(repo)], {
			maxBytes: MAX_API_BYTES,
			headers: { "User-Agent": USER_AGENT },
		})
		let parsed: unknown
		try {
			parsed = JSON.parse(raw) as unknown
		} catch {
			throw new MarketFetchError("failed", "release payload is not valid JSON")
		}
		const result = githubReleasePayload.safeParse(parsed)
		if (!result.success) {
			throw new MarketFetchError("failed", "release payload failed validation")
		}
		const release = result.data
		const version = release.tag_name.replace(/^v/, "")
		const asset = pickZipAsset(
			release.assets ?? [],
			manifest.id,
			release.tag_name,
			version,
		)
		const sidecar =
			asset === undefined
				? undefined
				: await readSha256Sidecar(release.assets ?? [], asset.name)
		const intro = await readIntroAssets(release.assets ?? [])
		const latest: MarketLatest = {
			tag: release.tag_name,
			version,
			releaseUrl: release.html_url,
			publishedAt: release.published_at ?? null,
			notes: truncate(release.body ?? null, NOTES_MAX_LENGTH),
			assetName: asset?.name,
			assetUrl: asset?.browser_download_url,
			...(sidecar !== undefined ? { sha256: sidecar } : {}),
			...(intro !== undefined ? { intro } : {}),
		}
		return latest
	}

	/**
	 * The `intro.<locale>.md` release assets — the plugin's version-pinned
	 * introduction, one markdown per locale. Best-effort per locale: a
	 * missing/over-limit asset just drops that locale; all failures leave
	 * `intro` unset rather than failing the catalog entry.
	 */
	async function readIntroAssets(
		assets: readonly GithubAsset[],
	): Promise<Readonly<Record<string, string>> | undefined> {
		const intro: Record<string, string> = {}
		for (const asset of assets) {
			const match = asset.name.match(INTRO_ASSET_RE)
			if (match === null) continue
			try {
				intro[match[1]!] = await fetchTextBestEffort(
					[asset.browser_download_url],
					{
						maxBytes: MAX_INTRO_BYTES,
						headers: { "User-Agent": USER_AGENT },
					},
				)
			} catch {
				// Missing or over-limit intro — skip just this locale.
			}
		}
		return Object.keys(intro).length === 0 ? undefined : intro
	}

	/**
	 * The `.sha256` sidecar beside the zip — best-effort integrity extra
	 * for a release that ships one; any failure leaves it unset rather
	 * than failing the catalog entry.
	 */
	async function readSha256Sidecar(
		assets: readonly GithubAsset[],
		assetName: string,
	): Promise<string | undefined> {
		const sidecar = assets.find((a) => a.name === `${assetName}.sha256`)
		if (sidecar === undefined) return undefined
		try {
			const text = await fetchTextBestEffort([sidecar.browser_download_url], {
				maxBytes: MAX_SHA256_BYTES,
				headers: { "User-Agent": USER_AGENT },
			})
			const match = text.trim().match(/^[0-9a-fA-F]{64}$/)
			return match === null ? undefined : match[0].toLowerCase()
		} catch {
			return undefined
		}
	}

	async function fetchTextBestEffort(
		urls: readonly string[],
		opts: {
			readonly maxBytes: number
			readonly headers?: Readonly<Record<string, string>>
		},
	): Promise<string> {
		await mkdir(tmpDir, { recursive: true })
		let lastMissing: MarketFetchError | undefined
		for (const url of urls) {
			try {
				const target = join(tmpDir, `marketplace-${randomUUID()}.tmp`)
				try {
					await fetcher.fetchToFile(url, target, opts)
					return await readFile(target, "utf-8")
				} finally {
					await rm(target, { force: true }).catch(() => {})
				}
			} catch (err) {
				const classified =
					err instanceof MarketFetchError ? err : classifyFetchError(err)
				if (classified.kind === "missing") {
					// This ref (branch) does not exist — try the next one.
					lastMissing = classified
					continue
				}
				throw classified
			}
		}
		throw lastMissing ?? new MarketFetchError("failed", "no URLs to fetch")
	}

	return { getConfig, setConfig, refresh, install }
}

// ── module helpers ────────────────────────────────────────────────────────

/**
 * Accept `owner/repo` or a full `https://github.com/owner/repo` address
 * (optionally with `www.` host prefix, a `.git` suffix or a trailing
 * slash; never with extra path segments) and return the normalized
 * `owner/repo`.
 * @throws DomainError (VALIDATION) for anything else.
 */
export function normalizeRepoAddress(raw: string): string {
	const trimmed = raw.trim()
	if (trimmed.length === 0) {
		throw invalid(
			"marketplace.repo_invalid",
			"repository address must not be empty",
		)
	}
	let path = trimmed.replace(/^https?:\/\//i, "")
	path = path.replace(/^(www\.)?github\.com\//i, "")
	path = path.replace(/^github\.com\//i, "")
	path = path.replace(/\.git$/i, "")
	path = path.replace(/\/+$/, "")

	const match = path.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
	if (match === null) {
		throw invalid(
			"marketplace.repo_invalid",
			'expected a GitHub repository address like "owner/repo" or "https://github.com/owner/repo"',
		)
	}
	return `${match[1]}/${match[2]}`
}

function assertAssetHost(rawUrl: string): void {
	let url: URL
	try {
		url = new URL(rawUrl)
	} catch {
		throw invalid(
			"marketplace.asset_url_invalid",
			"plugin asset URL is invalid",
		)
	}
	if (!ASSET_HOSTS.has(url.hostname)) {
		throw invalid(
			"marketplace.asset_host_forbidden",
			`plugin asset host is not an official GitHub release host: ${url.hostname}`,
		)
	}
}

function rawUrls(repo: string, path: string): string[] {
	return REFS.map(
		(ref) => `https://raw.githubusercontent.com/${repo}/${ref}/${path}`,
	)
}

function apiReleaseUrl(repo: string): string {
	return `https://api.github.com/repos/${repo}/releases/latest`
}

function pickZipAsset(
	assets: readonly GithubAsset[],
	id: string,
	tag: string,
	version: string,
): GithubAsset | undefined {
	const wanted = new Set([`${id}-${tag}.zip`, `${id}-${version}.zip`])
	for (const asset of assets) {
		if (wanted.has(asset.name)) return asset
	}
	return assets.find((asset) => asset.name.toLowerCase().endsWith(".zip"))
}

function truncate(value: string | null, max: number): string | null {
	if (value === null) return null
	return value.length > max ? `${value.slice(0, max)}...` : value
}

function classifyFetchError(err: unknown): MarketFetchError {
	const message = err instanceof Error ? err.message : String(err)
	if (message.includes("HTTP 404")) {
		return new MarketFetchError("missing", message)
	}
	if (message.includes("HTTP 403") || message.includes("HTTP 429")) {
		return new MarketFetchError("rate_limited", message)
	}
	return new MarketFetchError("failed", message)
}

function fetchFailureMessage(err: unknown, what: string): string {
	if (err instanceof MarketFetchError && err.kind === "rate_limited") {
		return `GitHub API rate limit hit while fetching ${what} — the unauthenticated quota resets hourly; try again later`
	}
	if (err instanceof MarketFetchError && err.kind === "missing") {
		return `not found (${what})`
	}
	return `fetching ${what} failed: ${err instanceof Error ? err.message : String(err)}`
}

function registryErrorFor(err: unknown, repo: string): never {
	if (err instanceof MarketFetchError && err.kind === "rate_limited") {
		throw invalid(
			"marketplace.rate_limited",
			"GitHub API rate limit hit while fetching the registry",
		)
	}
	if (err instanceof MarketFetchError && err.kind === "missing") {
		throw invalid(
			"marketplace.registry_missing",
			`the registry repo ${repo} has no registry.json (or is not public)`,
		)
	}
	throw invalid(
		"marketplace.registry_fetch_failed",
		`fetching the registry failed: ${err instanceof Error ? err.message : String(err)}`,
	)
}
