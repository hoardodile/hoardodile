import type { PluginManifest, PluginPermissions } from "@hoardodile/sdk-types"
import { z } from "zod"

/**
 * System-preference key holding the marketplace registry repo
 * ("owner/repo", normalized). Sync-scoped like every document-level
 * preference, so a LAN client shares the same marketplace.
 *
 * The value is tri-state: absent = the built-in default registry,
 * `""` (written by `setConfig(null)`) = explicitly disabled, anything
 * else = the configured registry.
 */
export const MARKETPLACE_PREF_KEY = "marketplace.registryRepo"

/**
 * Built-in default registry repo — the official Hoardodile marketplace.
 * Used whenever the preference is absent (a fresh install has never
 * configured a registry), so the catalog works out of the box.
 */
export const DEFAULT_MARKETPLACE_REPO = "hoardodile/marketplace"

/**
 * The registry file at the root of the registry repo. Deliberately tiny —
 * a plain list of plugin repository addresses. Everything else (names,
 * versions, permissions, release notes, assets) is fetched from each
 * plugin repo and its GitHub releases.
 */
export const marketRegistryFile = z.object({
	version: z.number().int().positive(),
	plugins: z.array(z.string().min(1).max(300)).min(1),
})
export type MarketRegistryFile = z.infer<typeof marketRegistryFile>

export type MarketLatest = {
	/** Raw release tag, e.g. `v1.2.3-beta.1`. */
	readonly tag: string
	/** Tag with the leading `v` stripped — the version shown for comparisons. */
	readonly version: string
	readonly releaseUrl: string
	readonly publishedAt: string | null
	/** Release notes, converted from the atom feed's content HTML to markdown. */
	readonly notes: string | null
	/**
	 * Present when the release payload was built (installable/updatable).
	 * Absent on a *degraded* version-only entry: the version/tag came from
	 * the free `releases.atom` feed, but the asset list could not be
	 * fetched (web endpoint 403/429), so install/update is blocked until
	 * the endpoint recovers.
	 */
	readonly assetName?: string
	readonly assetUrl?: string
	/** Contents of the `<asset>.sha256` sidecar, when the release ships one. */
	readonly sha256?: string
	/**
	 * The release's `README.<locale>.md` assets plus the bare `README.md`
	 * fallback — the author-published, version-pinned plugin readme,
	 * locale → markdown (the bare `README.md` is stored under `en`).
	 * Absent when the release ships none.
	 */
	readonly readme?: Readonly<Record<string, string>>
}

export type MarketPlugin = {
	/** App manifest id (UUID) — the key for installed-state matching. */
	readonly id: string
	/** Normalized `owner/repo`. */
	readonly repo: string
	readonly name: string
	readonly description: string
	readonly icon: string | undefined
	readonly permissions: PluginPermissions
	/**
	 * The full parsed manifest — authoritative; the projection fields above
	 * are convenience copies. Carried so the UI resolves i18n display
	 * names/descriptions and renders the search-category popover exactly
	 * like the plugins page.
	 */
	readonly manifest: PluginManifest
	/**
	 * The catalog state, derived from the manifest and the free
	 * `releases.atom` feed only — the snapshot never calls the GitHub API,
	 * so `error`/`rateLimited` are never set here (`state` is `"ok"` when a
	 * release was found, `"no_release"` otherwise). The authoritative
	 * release (asset / readme / notes / sha256) is built on demand — see
	 * {@link MarketPluginDetail}.
	 */
	readonly state: "ok" | "no_release" | "error"
	/**
	 * A version-only {@link MarketLatest} read from the free `releases.atom`
	 * feed: the tag + published date, with no asset / notes / readme. The
	 * installable payload (asset / sha256 / notes / readme) arrives only via
	 * {@link MarketplaceService.detail} when the user opens a plugin's view.
	 */
	readonly latest: MarketLatest | undefined
	/** Human-readable reason when `state` is `error`. */
	readonly error: string | undefined
	/**
	 * Machine-readable error classification when `state` is `error` — the
	 * UI picks friendly copy off it instead of the raw message.
	 */
	readonly errorKind?: "rate_limited" | "failed" | "missing"
	/**
	 * True when the shown release payload was served from the cache or from
	 * the free `releases.atom` feed after a GitHub web-endpoint rate limit
	 * hit — `state` stays `ok` (data is usable) but the release info may be
	 * stale or, for a version-only entry, not installable; the UI flags it
	 * on the card and notes a new version may be waiting.
	 */
	readonly rateLimited?: boolean
}

export type MarketError = {
	readonly repo: string
	readonly message: string
}

export type MarketSnapshot = {
	readonly registryRepo: string
	readonly fetchedAt: number
	readonly plugins: readonly MarketPlugin[]
	/**
	 * Repos the registry listed — or an installed plugin's recorded source
	 * repo — that could not be loaded as plugins.
	 */
	readonly errors: readonly MarketError[]
}

/**
 * One plugin's authoritative latest release, built on demand when the user
 * opens the marketplace "View" dialog. Unlike the snapshot's version-only
 * {@link MarketPlugin.latest}, this holds the installable payload — the
 * asset URL, sha256, release notes and the version-pinned readme — and is
 * assembled from quota-free GitHub web endpoints (the atom feed plus the
 * `releases/expanded_assets` fragment). Cached per repo server-side
 * (persisted) and client-side, so repeated opens never re-fetch within the
 * cache window.
 */
export type MarketPluginDetail = {
	/** Normalized `owner/repo`. */
	readonly repo: string
	readonly state: "ok" | "no_release" | "error"
	/** The authoritative latest release (asset / notes / readme / sha256). */
	readonly latest: MarketLatest | undefined
	/** Human-readable reason when `state` is `error`. */
	readonly error: string | undefined
	readonly errorKind?: "rate_limited" | "failed" | "missing"
	/**
	 * True when the release payload was served from the cache or from the
	 * free `releases.atom` feed after a web-endpoint rate limit — a
	 * version-only entry (asset absent) is not actionable until the
	 * endpoint recovers.
	 */
	readonly rateLimited?: boolean
}

export type MarketInstallInput = {
	readonly id: string
	/** Normalized `owner/repo` the plugin is installed from — later the
	    update source remembered across registry switches. */
	readonly repo: string
	readonly assetUrl: string
	readonly sha256?: string
}
