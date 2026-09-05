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
	MARKETPLACE_PREF_KEY,
	type MarketError,
	type MarketInstallInput,
	type MarketLatest,
	type MarketPlugin,
	type MarketPluginDetail,
	type MarketSnapshot,
	marketRegistryFile,
} from "./schema.ts"

/**
 * The plugin marketplace: a registry repo (a `registry.json` listing
 * plugin repository addresses) plus per-plugin GitHub metadata served
 * straight from each repo — everything the UI shows is fetched, the
 * registry only carries the addresses.
 *
 * Data channels — all quota-free web endpoints, so the marketplace works
 * even when the GitHub API's unauthenticated 60/hour-per-IP quota is
 * exhausted (shared proxies/NAT exhaust it easily):
 * - registry file + each plugin's `manifest.json`: `raw.githubusercontent.com`
 *   (no API quota; ref fallback `HEAD` → `main` → `master`);
 * - the **catalog** latest version: the free GitHub releases feed
 *   (`github.com/<repo>/releases.atom`, a web endpoint — no API quota) —
 *   the list snapshot reads only the tag + date, so it stays fast and never
 *   touches the API;
 * - the **authoritative** latest release (asset / notes / readme / sha256):
 *   built on demand when the user opens a plugin's view
 *   ({@link MarketplaceService.detail}) from the atom feed (tag, date and
 *   the release-notes HTML in the first entry) plus
 *   `github.com/<repo>/releases/expanded_assets/<tag>` (the release's
 *   asset list — a web endpoint, no API quota), cached per repo so repeated
 *   opens reuse the cache. Github web endpoints may still answer 403/429
 *   under secondary rate limits; those degrade to the version-only feed
 *   data with a cooldown, exactly like the old API path;
 * - install/update assets: the release's `browser_download_url`
 *   (a direct `github.com` download, no API quota).
 *
 * All fetching goes through the app's hardened HTTP client — the same
 * policy (public-address pinning, redirect re-vetting, byte caps) the
 * plugin vault downloads use.
 */

/**
 * Cache windows for the marketplace. All three are env-configurable via
 * `createMarketplaceService` deps and default to a day — the on-demand
 * release build re-downloads the per-locale readmes and the asset list,
 * so long windows keep reopened views cheap (and persist the payload
 * across restarts). A forced refresh (the Settings button) still bypasses
 * the release window and degrades to cached data on failure.
 */
const DAY_MS = 24 * 60 * 60_000
const MAX_RAW_BYTES = 512 * 1024
/** Byte cap for the `expanded_assets` fragment (the asset-list page). */
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024
const MAX_SHA256_BYTES = 8 * 1024
const MAX_README_BYTES = 256 * 1024
/** Byte cap for the free GitHub releases feed (rate-limit fallback). */
const MAX_ATOM_BYTES = 256 * 1024
/** Release-body cap for the dedicated Release notes tab (still bounded by the payload cap). */
const NOTES_MAX_LENGTH = 128_000
const REFS = ["HEAD", "main", "master"] as const
const WEB_FETCH_CONCURRENCY = 5
const USER_AGENT = "hoardodile-plugin-marketplace"
/** Release-asset names for the author-published readme: `README.<locale>.md` (bare `README.md` is the fallback). */
const README_ASSET_RE = /^README\.([A-Za-z0-9-]{1,20})\.md$/

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

/** Narrow structural view of the installed-plugin source provenance. */
type MarketplaceSources = {
	/**
	 * Persist the normalized source repo for a just-installed plugin —
	 * the update source brought back into the snapshot even after the
	 * registry the user installed from is switched away.
	 */
	readonly recordInstallSource: (id: string, repo: string) => void
	/** Installed plugins with a recorded source repo (`id` → `repo`). */
	readonly listInstallSources: () => readonly {
		readonly id: string
		readonly repo: string
	}[]
}

export type MarketplaceServiceDeps = {
	readonly prefs: MarketplacePrefs
	readonly sources: MarketplaceSources
	readonly fetcher: MarketplaceFetcher
	readonly installer: MarketplaceInstaller
	readonly rescan: () => Promise<void>
	/**
	 * Best-effort notification that a plugin was just installed/updated:
	 * the host runs the plugin's optional `onInstall` hook (fire-and-forget
	 * from the caller's perspective — a failing or consent-denied hook
	 * never fails the install).
	 */
	readonly postInstall: (pluginId: string) => void
	/** Temp directory for downloaded registries/manifests/install zips. */
	readonly tmpDir: string
	/** Byte cap for one install download (mirrors the plugin upload cap). */
	readonly maxInstallBytes: number
	/**
	 * Persistent release-cache file (`local/cache/marketplace-releases.json`).
	 * Survives server restarts so the release payload is built at most once
	 * per repo per cache window.
	 */
	readonly releaseCacheFile: string
	/** Snapshot cache window in ms (defaults to `DAY_MS`). */
	readonly cacheTtlMs?: number
	/** Per-repo release-payload cache window in ms (defaults to `DAY_MS`). */
	readonly releaseCacheTtlMs?: number
	/** Post-403/429 web-endpoint cooldown in ms (defaults to `DAY_MS`). */
	readonly rateLimitCooldownMs?: number
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
	 * Snapshot of the curated marketplace. Served from an in-memory cache
	 * (default window: one day) unless `force` (the "refresh now" button);
	 * a single in-flight refresh is shared by concurrent callers.
	 */
	refresh(force: boolean): Promise<MarketSnapshot>
	/** Download + validate + install a release asset (install or update). */
	install(input: MarketInstallInput): Promise<{ readonly pluginId: string }>
	/**
	 * One repo's authoritative latest release (asset / notes / readme /
	 * sha256), built from quota-free GitHub web endpoints on demand when
	 * the user opens a plugin's view, and cached per repo (persisted
	 * release cache + cooldown) so an open is served from cache instead
	 * of re-fetching the endpoints.
	 */
	detail(repo: string, id: string): Promise<MarketPluginDetail>
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
	const cacheTtlMs = deps.cacheTtlMs ?? DAY_MS
	const releaseCacheTtlMs = deps.releaseCacheTtlMs ?? DAY_MS
	const rateLimitCooldownMs = deps.rateLimitCooldownMs ?? DAY_MS
	const limiter: ConcurrencyLimiter = createConcurrencyLimiter(
		WEB_FETCH_CONCURRENCY,
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
			if (cached !== undefined && now() - cached.fetchedAt < cacheTtlMs) {
				return cached.snapshot
			}
		}
		if (pending !== undefined) return await pending
		pending = buildAndCache(repo).finally(() => {
			pending = undefined
		})
		return await pending
	}

	async function install(
		input: MarketInstallInput,
	): Promise<{ readonly pluginId: string }> {
		const repo = normalizeRepoAddress(input.repo)
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
			// Remember the source repo last — the rescan's `syncRecords`
			// creates the settings row when the plugin was never
			// configured, and the record must survive a registry switch.
			deps.sources.recordInstallSource(pluginId, repo)
			// The registry now knows the plugin: ask it to run its
			// optional post-install work (e.g. downloading pinned runtime
			// files behind the shared consent dialog). Best-effort.
			deps.postInstall(pluginId)
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

	async function buildAndCache(repo: string): Promise<MarketSnapshot> {
		const snapshot = await buildSnapshot(repo)
		cache.set(repo, { snapshot, fetchedAt: snapshot.fetchedAt })
		return snapshot
	}

	async function buildSnapshot(repo: string): Promise<MarketSnapshot> {
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
			entries.map((entry) => limiter.run(() => loadPlugin(entry))),
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
		await mergeInstalledOrigins(plugins, errors)
		persistReleaseCache()
		return {
			registryRepo: repo,
			fetchedAt: now(),
			plugins,
			errors,
		}
	}

	/**
	 * Bring installed plugins' source repos back into the snapshot: an
	 * installed plugin whose repo is no longer listed by the current
	 * registry (the user switched registries) would otherwise lose its
	 * update detection. Repos already providing a catalog entry are
	 * re-used; one load per unique origin repo (same limiter, release
	 * cache and error classification as the registry entries).
	 */
	async function mergeInstalledOrigins(
		plugins: MarketPlugin[],
		errors: MarketError[],
	): Promise<void> {
		const catalogIds = new Set(plugins.map((plugin) => plugin.id))
		const catalogRepos = new Set(plugins.map((plugin) => plugin.repo))
		const originRepoById = new Map<string, string>()
		for (const origin of deps.sources.listInstallSources()) {
			if (catalogIds.has(origin.id) || catalogRepos.has(origin.repo)) {
				continue
			}
			originRepoById.set(origin.id, origin.repo)
		}
		const repos = new Set(originRepoById.values())
		const results = await Promise.all(
			[...repos].map((repo) => limiter.run(() => loadPlugin(repo))),
		)
		for (const result of results) {
			if (result.kind === "error") {
				errors.push({ repo: result.repo, message: result.message })
				continue
			}
			const plugin = result.plugin
			// Only the installed plugin ids may enter the catalog — a repo
			// that renamed its manifest id no longer sources them.
			if (!catalogIds.has(plugin.id) && originRepoById.has(plugin.id)) {
				plugins.push(plugin)
				catalogIds.add(plugin.id)
			}
		}
	}

	async function loadPlugin(repo: string): Promise<
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

		// The catalog reads only the free `releases.atom` feed — a web
		// endpoint with no API quota, like every other marketplace channel.
		// A repo with no published release (no atom entry) lists as
		// `no_release`; otherwise the version-only latest is surfaced so
		// the list can render the version/date line and the update signal.
		// The installable payload (asset / notes / readme / sha256) is
		// built on demand via `detail`, also quota-free.
		const entry = await fetchLatestReleaseEntry(repo)
		if (entry === undefined) {
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
		return {
			kind: "plugin",
			plugin: {
				...base,
				state: "ok",
				latest: latestFromAtom(repo, entry),
				error: undefined,
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
	 * One repo's latest release — built on demand from the quota-free
	 * GitHub web endpoints (the atom feed's tag/date/notes HTML plus the
	 * `releases/expanded_assets` fragment's asset list), cached per repo
	 * for the cache window (default one day, and persisted to disk)
	 * because a build re-downloads the per-locale readmes. A web endpoint
	 * answering 403/429 (GitHub secondary rate limits) degrades to the
	 * stale cached payload instead of erroring (flagged as degraded); the
	 * cooldown marker suppresses further attempts for the same window.
	 *
	 * So the user still learns a new version was published even under a
	 * web-endpoint limit, a degraded build first asks the free
	 * `releases.atom` feed for the true latest tag. When that tag differs
	 * from the cached release (or there is none), the marketplace
	 * surfaces a version-only {@link MarketLatest} (asset omitted) flagged
	 * `degraded` — the UI shows the version and notes the install/update
	 * is temporarily unavailable. When the feed tag matches the cached
	 * payload the cache is current and its asset is kept, so an update
	 * stays possible from cache.
	 *
	 * The manual "refresh now" passes `bypass = true`: it re-checks the
	 * endpoints regardless of the TTL AND bypasses the rate-limit cooldown
	 * — the user has explicitly asked to retry, so a single bounded pass
	 * re-hits them and re-arms the cooldown if the limit is still in
	 * effect. Automatic (non-force) rebuilds still honor the cooldown so
	 * they never hammer the endpoints. Any other failure still degrades
	 * to cached data.
	 */
	async function loadLatest(
		repo: string,
		id: string,
		bypass: boolean,
	): Promise<ReleaseLoadResult> {
		loadReleaseCache()
		const cached = releaseCache.get(repo)
		if (
			!bypass &&
			cached?.latest !== undefined &&
			cached.fetchedAt !== undefined &&
			cached.rateLimitedUntil === undefined &&
			now() - cached.fetchedAt < releaseCacheTtlMs
		) {
			return { latest: cached.latest, degraded: false }
		}
		const cooldownActive =
			cached?.rateLimitedUntil !== undefined && cached.rateLimitedUntil > now()

		if (!cooldownActive || bypass) {
			try {
				const latest = await buildLatestFromWeb(repo, id)
				// A fresh answer is authoritative — drop any feed-learned tag.
				releaseCache.set(repo, { latest, fetchedAt: now() })
				markReleaseCacheDirty()
				return { latest, degraded: false }
			} catch (err) {
				if (err instanceof MarketFetchError && err.kind === "rate_limited") {
					releaseCache.set(repo, {
						...(cached !== undefined ? { ...cached } : {}),
						rateLimitedUntil: now() + rateLimitCooldownMs,
					})
					markReleaseCacheDirty()
				} else if (bypass && cached?.latest !== undefined) {
					// A forced refresh that fails keeps serving the cached
					// payload rather than dropping the entry.
					return { latest: cached.latest, degraded: false }
				} else {
					throw err
				}
			}
		}

		// Rate-limited (or within the cooldown): learn the true latest tag
		// from the free releases feed so the version is still visible.
		const known = await fetchLatestReleaseEntry(repo)
		if (known !== undefined) {
			if (cached?.latest !== undefined && cached.latest.tag === known.tag) {
				// The cached payload is already the current release — keep its
				// asset so install/update still works from cache.
				return { latest: cached.latest, degraded: true }
			}
			// A newer (or first) release with no fetchable asset — surface the
			// version only; the UI notes it is not yet actionable.
			return { latest: latestFromAtom(repo, known), degraded: true }
		}

		if (cached?.latest !== undefined) {
			return { latest: cached.latest, degraded: true }
		}
		throw new MarketFetchError(
			"rate_limited",
			"GitHub web endpoint rate limit hit — no cached release data yet",
		)
	}

	/**
	 * One repo's authoritative latest release, built on demand when the
	 * user opens a plugin's view. Unlike the snapshot (version-only,
	 * free `releases.atom`), this reads the full release payload — the
	 * asset list, sha256 sidecar, release notes (HTML in the atom entry,
	 * converted to markdown) and the version-pinned readme — so
	 * install/update becomes actionable. Everything comes from quota-free
	 * GitHub web endpoints, so a shared IP's exhausted API quota can
	 * never block the view. Cached per repo (persisted release cache +
	 * cooldown), so repeated opens reuse the cache instead of re-hitting
	 * the endpoints.
	 */
	async function detail(repo: string, id: string): Promise<MarketPluginDetail> {
		const normalized = normalizeRepoAddress(repo)
		try {
			const result = await loadLatest(normalized, id, false)
			return {
				repo: normalized,
				state: "ok",
				latest: result.latest,
				error: undefined,
				...(result.degraded ? { rateLimited: true } : {}),
			}
		} catch (err) {
			if (err instanceof MarketFetchError && err.kind === "missing") {
				// A repo with a manifest but no published release (no atom
				// entry) — the view shows "no release".
				return {
					repo: normalized,
					state: "no_release",
					latest: undefined,
					error: undefined,
				}
			}
			const kind = err instanceof MarketFetchError ? err.kind : "failed"
			return {
				repo: normalized,
				state: "error",
				latest: undefined,
				error: fetchFailureMessage(err, "latest release"),
				...(kind !== undefined ? { errorKind: kind } : {}),
			}
		} finally {
			// Flush a fresh answer or a re-armed cooldown promptly — the
			// detail path is now the only writer to the persisted cache.
			persistReleaseCache()
		}
	}

	/** Fetch + parse the first entry of the repo's `releases.atom` feed. */
	async function fetchLatestReleaseEntry(
		repo: string,
	): Promise<
		{ readonly tag: string; readonly publishedAt: string | null } | undefined
	> {
		try {
			const text = await fetchTextBestEffort([atomReleaseUrl(repo)], {
				maxBytes: MAX_ATOM_BYTES,
				headers: { "User-Agent": USER_AGENT },
			})
			return parseAtomFirstEntry(text)
		} catch {
			// No feed (a repo without a release), blocked or over-limit — stay quiet.
			return undefined
		}
	}

	/**
	 * Build the authoritative latest release payload from the quota-free
	 * web endpoints: the atom entry (tag, date, release-notes HTML) plus
	 * the `releases/expanded_assets/<tag>` fragment (the asset list). An
	 * unparseable fragment degrades to an empty asset list (the version
	 * and notes still surface); a transport failure propagates so the
	 * caller can degrade/cooldown instead of serving a half payload.
	 */
	async function buildLatestFromWeb(
		repo: string,
		id: string,
	): Promise<MarketLatest> {
		const text = await fetchTextBestEffort([atomReleaseUrl(repo)], {
			maxBytes: MAX_ATOM_BYTES,
			headers: { "User-Agent": USER_AGENT },
		})
		const entry = parseAtomFirstEntry(text)
		if (entry === undefined) {
			throw new MarketFetchError(
				"missing",
				"the releases.atom feed carries no release entry",
			)
		}
		const { tag, publishedAt } = entry
		const version = tag.replace(/^v/, "")
		const assets = await fetchExpandedAssets(repo, tag)
		const asset = pickZipAsset(assets, id, tag, version)
		const sidecar =
			asset === undefined
				? undefined
				: await readSha256Sidecar(assets, asset.name)
		const readme = await readReadmeAssets(assets)
		// The atom content is the release body rendered as HTML; convert it
		// (best-effort — a parse oddity degrades to null notes, never a failure).
		let notes: string | null = null
		if (entry.notesHtml !== undefined) {
			try {
				notes = truncate(htmlToMarkdown(entry.notesHtml), NOTES_MAX_LENGTH)
			} catch {
				notes = null
			}
		}
		return {
			tag,
			version,
			releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
			publishedAt,
			notes,
			assetName: asset?.name,
			assetUrl: asset?.browser_download_url,
			...(sidecar !== undefined ? { sha256: sidecar } : {}),
			...(readme !== undefined ? { readme } : {}),
		}
	}

	/**
	 * The release's asset list from `releases/expanded_assets/<tag>` — a
	 * web endpoint (no API quota). The fragment is an HTML list whose rows
	 * are `<a href="/<repo>/releases/download/<tag>/<name>">` links, each
	 * with a `<span class="text-bold">` carrying the raw asset name.
	 */
	async function fetchExpandedAssets(
		repo: string,
		tag: string,
	): Promise<GithubAsset[]> {
		const text = await fetchTextBestEffort([expandedAssetsUrl(repo, tag)], {
			maxBytes: MAX_EXPANDED_BYTES,
			headers: { "User-Agent": USER_AGENT },
		})
		return parseExpandedAssets(text)
	}

	/**
	 * The `README.<locale>.md` release assets plus the bare `README.md`
	 * fallback — the plugin's version-pinned readme, one markdown per
	 * locale. The bare `README.md` is stored under the `en` key: English
	 * normally lives there (no `README.en.md` is needed) and every other
	 * language falls back to it. Best-effort per locale: a missing or
	 * over-limit asset just drops that locale; all failures leave
	 * `readme` unset rather than failing the catalog entry.
	 */
	async function readReadmeAssets(
		assets: readonly GithubAsset[],
	): Promise<Readonly<Record<string, string>> | undefined> {
		const readme: Record<string, string> = {}
		for (const asset of assets) {
			const match = asset.name.match(README_ASSET_RE)
			if (match !== null) {
				try {
					readme[match[1]!] = await fetchTextBestEffort(
						[asset.browser_download_url],
						{
							maxBytes: MAX_README_BYTES,
							headers: { "User-Agent": USER_AGENT },
						},
					)
				} catch {
					// Missing or over-limit readme — skip just this locale.
				}
				continue
			}
			if (asset.name === "README.md") {
				try {
					readme.en = await fetchTextBestEffort([asset.browser_download_url], {
						maxBytes: MAX_README_BYTES,
						headers: { "User-Agent": USER_AGENT },
					})
				} catch {
					// Missing or over-limit fallback readme — skip.
				}
			}
		}
		return Object.keys(readme).length === 0 ? undefined : readme
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

	return { getConfig, setConfig, refresh, install, detail }
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

/** The free GitHub releases feed — a web endpoint, so it never consumes
    the REST API quota. */
function atomReleaseUrl(repo: string): string {
	return `https://github.com/${repo}/releases.atom`
}

/** The release's asset-list page — a web endpoint, so it never consumes
    the REST API quota. */
function expandedAssetsUrl(repo: string, tag: string): string {
	return `https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`
}

/** The first entry of a repo's `releases.atom` feed, as far as the
    marketplace reads it. */
export type AtomFirstEntry = {
	readonly tag: string
	readonly publishedAt: string | null
	/**
	 * The release body as HTML (the entry's `<content>` element), entity-
	 * decoded, or `undefined` when the feed ships no content element.
	 */
	readonly notesHtml: string | undefined
}

/**
 * Parse the latest release entry out of a GitHub `releases.atom` feed —
 * the first `<entry>` is the newest published release. The tag is taken
 * from the entry's `rel="alternate"` link (the authoritative
 * `releases/tag/<tag>` URL, immune to entity/whitespace issues in the
 * title), falling back to the `title` element; the date from `<updated>`;
 * the release notes from the `<content>` element (GitHub emits them as
 * HTML, XML-entity-escaped inside the feed). Returns `undefined` on any
 * structural mismatch so a feed change degrades to the existing behavior
 * instead of throwing.
 */
export function parseAtomFirstEntry(xml: string): AtomFirstEntry | undefined {
	const first = /<entry>[\s\S]*?<\/entry>/.exec(xml)?.[0]
	if (first === undefined) return undefined
	const title = /<title[^>]*>([^<]*)<\/title>/.exec(first)?.[1]
	// The alternate link carries the authoritative `releases/tag/<tag>` URL;
	// match the element first so attribute order never matters.
	const linkEl = /<link\b[^>]*\brel="alternate"[^>]*>/.exec(first)?.[0]
	const alternateHref =
		linkEl === undefined ? undefined : /href="([^"]*)"/.exec(linkEl)?.[1]
	const tag = tagFromUrl(alternateHref) ?? title?.trim()
	if (tag === undefined || tag.length === 0) return undefined
	const publishedAt = /<updated>([^<]*)<\/updated>/.exec(first)?.[1] ?? null
	const notesHtml = parseAtomContent(first)
	return { tag, publishedAt, notesHtml }
}

/**
 * The `<content>` element of a feed entry, XML-entity-decoded. GitHub
 * emits release bodies as `type="html"`; a `type="text"` (or absent type)
 * entry is plain text already. `undefined` when the entry has no content.
 */
function parseAtomContent(entry: string): string | undefined {
	const el = /<content\b([^>]*)>([\s\S]*?)<\/content>/.exec(entry)
	if (el === null) return undefined
	const attrs = el[1] ?? ""
	let body = el[2] ?? ""
	const type = /type="([^"]*)"/.exec(attrs)?.[1]
	if (type !== undefined && type !== "html" && type !== "text") {
		return undefined
	}
	// A feed may wrap the body in a CDATA section — unwrap it before the
	// regular entity decode.
	if (body.startsWith("<![CDATA[")) {
		body = body.slice("<![CDATA[".length)
		if (body.endsWith("]]>")) body = body.slice(0, -3)
	}
	return decodeXmlEntities(body)
}

/** The XML character references a feed may carry (`&lt;` … plus numeric refs). */
function decodeXmlEntities(text: string): string {
	return decodeHtmlEntities(text)
}

/** Extract `<owner>/<repo>/releases/tag/<tag>` from an alternate link href. */
function tagFromUrl(rawUrl: string | undefined): string | undefined {
	if (rawUrl === undefined) return undefined
	try {
		const path = new URL(rawUrl).pathname
		const marker = "/releases/tag/"
		const idx = path.lastIndexOf(marker)
		if (idx === -1) return undefined
		const tag = path.slice(idx + marker.length)
		return tag.length > 0 ? decodeURIComponent(tag) : undefined
	} catch {
		return undefined
	}
}

/**
 * A version-only {@link MarketLatest} built from the free feed's latest tag:
 * the version is real (a published release), but the asset / notes / sha /
 * readme are unknown — a web-endpoint limit kept us from fetching them,
 * so install/update stays blocked until the endpoint recovers.
 */
function latestFromAtom(
	repo: string,
	known: { readonly tag: string; readonly publishedAt: string | null },
): MarketLatest {
	return {
		tag: known.tag,
		version: known.tag.replace(/^v/, ""),
		releaseUrl: `https://github.com/${repo}/releases/tag/${known.tag}`,
		publishedAt: known.publishedAt,
		notes: null,
	}
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

/**
 * Parse the asset list of a `releases/expanded_assets/<tag>` fragment.
 * GitHub renders one row per asset as
 * `<a href="/<repo>/releases/download/<tag>/<name>"><span class="text-bold">name</span></a>`;
 * the name from the span (raw, unescaped display form) and the download
 * URL from the href. Degenerates to `[]` on a fragment that carries no
 * asset rows (e.g. a release with no files), never throws.
 */
export function parseExpandedAssets(html: string): GithubAsset[] {
	const out: GithubAsset[] = []
	const seen = new Set<string>()
	for (const match of html.matchAll(
		/<a\b[^>]*\bhref="([^"]*\/releases\/download\/[^"]+)"[^>]*>\s*<span class="text-bold">([^<]+)<\/span>/g,
	)) {
		const href = match[1]
		const name = match[2]
		if (href === undefined || name === undefined) continue
		const decodedName = decodeHtmlEntities(name)
		if (seen.has(decodedName)) continue
		seen.add(decodedName)
		out.push({
			name: decodedName,
			browser_download_url: `https://github.com${href}`,
		})
	}
	return out
}

/**
 * Decode the character references GitHub's markdown renderer can emit —
 * the five XML/HTML named refs plus decimal/hex numeric refs. Unknown
 * named refs are left verbatim (safe: they can never inject structure).
 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&#(\d+);/g, (_, digits: string) =>
			String.fromCodePoint(Number.parseInt(digits, 10)),
		)
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
}

/**
 * Convert the release-notes HTML (GitHub's sanitised markdown render,
 * carried inside the atom feed's `<content type="html">`) back to the
 * markdown shape the detail dialog renders. Covers the tag set GitHub
 * actually produces — headings, paragraphs, lists (incl. nested), links,
 * emphasis, code/pre, blockquote, hr, br, images — and skips unknown
 * elements' tags while keeping their text. Pure and deterministic; a
 * structural oddity throws so callers can degrade to `notes: null`.
 *
 * @throws when the input is not a string, so a malformed feed never
 *   produces a partial render.
 */
export function htmlToMarkdown(raw: string): string {
	if (typeof raw !== "string") throw new Error("release-notes HTML is not text")
	const nodes = parseHtml(decodeHtmlEntities(raw))
	return renderBlocks(nodes, 0).join("\n\n").trim()
}

// ── minimal HTML tokeniser + renderer for release notes ────────────────────

type HtmlNode =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "element"
			readonly name: string
			readonly attrs: ReadonlyMap<string, string>
			readonly children: readonly HtmlNode[]
	  }

/** Void HTML elements — parsed as elements with no children. */
const VOID_TAGS = new Set([
	"br",
	"hr",
	"img",
	"input",
	"meta",
	"link",
	"source",
])

function parseHtml(html: string): HtmlNode[] {
	let cursor = 0

	function readName(from: number): {
		readonly name: string
		readonly end: number
	} {
		let i = from
		while (i < html.length && /[a-zA-Z0-9-]/.test(html[i]!)) i += 1
		return { name: html.slice(from, i).toLowerCase(), end: i }
	}

	function readAttrs(from: number): {
		readonly attrs: Map<string, string>
		readonly end: number
	} {
		const attrs = new Map<string, string>()
		let i = from
		for (;;) {
			while (i < html.length && /\s/.test(html[i]!)) i += 1
			if (i >= html.length || html[i] === ">" || html[i] === "/") break
			const { name, end } = readName(i)
			if (name.length === 0) {
				i += 1
				continue
			}
			i = end
			while (i < html.length && /\s/.test(html[i]!)) i += 1
			let value = ""
			if (html[i] === "=") {
				i += 1
				while (i < html.length && /\s/.test(html[i]!)) i += 1
				const quote = html[i]
				if (quote === '"' || quote === "'") {
					i += 1
					const start = i
					while (i < html.length && html[i] !== quote) i += 1
					value = html.slice(start, i)
					if (html[i] === quote) i += 1
				} else {
					const start = i
					while (i < html.length && !/[\s>]/.test(html[i]!)) i += 1
					value = html.slice(start, i)
				}
			}
			attrs.set(name, value)
		}
		return { attrs, end: i }
	}

	function parseChildren(): HtmlNode[] {
		// Parse until a closing tag or the end of input is reached.
		const out: HtmlNode[] = []
		for (;;) {
			const next = html.indexOf("<", cursor)
			if (next === -1) {
				const text = html.slice(cursor)
				if (text.length > 0) out.push({ kind: "text", text })
				cursor = html.length
				return out
			}
			if (next > cursor)
				out.push({ kind: "text", text: html.slice(cursor, next) })
			cursor = next
			if (html.startsWith("<!--", cursor)) {
				const end = html.indexOf("-->", cursor)
				cursor = end === -1 ? html.length : end + 3
				continue
			}
			cursor += 1
			if (html.startsWith("/", cursor)) {
				// Closing tag — the caller consumes it.
				const { end } = readName(cursor + 1)
				cursor = end
				const closeTag = html.indexOf(">", cursor)
				if (closeTag !== -1) cursor = closeTag + 1
				return out
			}
			const { name, end } = readName(cursor)
			cursor = end
			const { attrs, end: attrsEnd } = readAttrs(cursor)
			cursor = attrsEnd
			if (VOID_TAGS.has(name) || html[cursor] === "/") {
				const close = html.indexOf(">", cursor)
				cursor = close === -1 ? html.length : close + 1
				out.push({ kind: "element", name, attrs, children: [] })
				continue
			}
			// Non-void element: consume children until the matching close.
			cursor += 1
			const children = parseChildren()
			out.push({ kind: "element", name, attrs, children })
		}
	}

	return parseChildren()
}

/** Inline markdown for the children of a block element (recurses into inline tags). */
function renderInline(nodes: readonly HtmlNode[]): string {
	let out = ""
	for (const node of nodes) {
		if (node.kind === "text") {
			out += node.text
			continue
		}
		const { name, attrs, children } = node
		switch (name) {
			case "a": {
				const href = attrs.get("href")
				const text = renderInline(children).trim()
				if (href === undefined || href.length === 0) {
					out += text
					continue
				}
				out += `[${text}](${href})`
				continue
			}
			case "strong":
			case "b":
				out += `**${renderInline(children)}**`
				continue
			case "em":
			case "i":
				out += `*${renderInline(children)}*`
				continue
			case "s":
			case "del":
				out += `~~${renderInline(children)}~~`
				continue
			case "code":
				out += `\`${renderInline(children).trim()}\``
				continue
			case "br":
				out += "\n"
				continue
			case "img": {
				const src = attrs.get("src")
				out += src === undefined ? "" : `![${attrs.get("alt") ?? ""}](${src})`
				continue
			}
			default:
				// Transparent inline containers and unknown tags: keep
				// content, strip structure.
				out += renderInline(children)
		}
	}
	return out
}

/** Block-level markdown lines for a sequence of sibling nodes (list items get their own indentation via `depth`). */
function renderBlocks(nodes: readonly HtmlNode[], depth: number): string[] {
	const lines: string[] = []
	for (const node of nodes) {
		if (node.kind === "text") {
			const text = node.text.trim()
			if (text.length > 0)
				lines.push(repeat("  ", depth) + text.replace(/\n{3,}/g, "\n\n"))
			continue
		}
		const { name, children } = node
		switch (name) {
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": {
				const level = Number(name[1])
				lines.push(
					repeat("  ", depth) +
						"#".repeat(level) +
						" " +
						renderInline(children).trim(),
				)
				break
			}
			case "p":
				lines.push(repeat("  ", depth) + renderInline(children).trim())
				break
			case "blockquote": {
				const inner = renderBlocks(children, depth)
					.map((line) => line.trim())
					.join("\n")
				lines.push(
					...inner.split("\n").map((line) => `${repeat("  ", depth)}> ${line}`),
				)
				break
			}
			case "pre": {
				const code = plainText(children)
				lines.push(
					repeat("  ", depth) +
						"```\n" +
						code +
						"\n" +
						repeat("  ", depth) +
						"```",
				)
				break
			}
			case "hr":
				lines.push(`${repeat("  ", depth)}---`)
				break
			case "ul":
			case "ol":
				lines.push(...renderList(name, children, depth))
				break
			case "li":
				// A bare li outside a list (malformed) — render as a flat item.
				lines.push(`${repeat("  ", depth)}- ${renderInline(children).trim()}`)
				break
			default:
				break
		}
	}
	return lines
}

function repeat(text: string, count: number): string {
	return count > 0 ? text.repeat(count) : ""
}

/** Raw text of a subtree — tags stripped, entities already decoded. */
function plainText(nodes: readonly HtmlNode[]): string {
	let out = ""
	for (const node of nodes) {
		if (node.kind === "text") out += node.text
		else out += plainText(node.children)
	}
	return out
}

function renderList(
	name: "ul" | "ol",
	items: readonly HtmlNode[],
	depth: number,
): string[] {
	const lines: string[] = []
	let index = 1
	for (const item of items) {
		if (item.kind !== "element" || item.name !== "li") continue
		const marker = name === "ol" ? `${index}. ` : "- "
		index += 1
		const inline: string[] = []
		const nested: HtmlNode[] = []
		for (const child of item.children) {
			if (
				child.kind === "element" &&
				(child.name === "ul" || child.name === "ol")
			) {
				nested.push(child)
				continue
			}
			// Single block children (a lone `<p>` wrapper) render inline.
			if (
				child.kind === "element" &&
				child.name === "p" &&
				item.children.length === 1
			) {
				inline.push(renderInline(child.children))
				continue
			}
			inline.push(renderInline([child]))
		}
		const text = inline.join("").replace(/\s+/g, " ").trim()
		lines.push(repeat("  ", depth) + marker + text)
		for (const list of nested) {
			if (list.kind !== "element") continue
			const childName = list.name === "ol" ? "ol" : "ul"
			lines.push(...renderList(childName, list.children, depth + 1))
		}
	}
	return lines
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
		return `GitHub rate limit hit while fetching ${what} — the free quota resets hourly; try again later`
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
			"GitHub rate limit hit while fetching the registry",
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
