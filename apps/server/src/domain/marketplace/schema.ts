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

/** GitHub `releases/latest` payload — the only fields the market reads. */
export const githubReleasePayload = z.object({
	tag_name: z.string().min(1),
	html_url: z.string().min(1),
	published_at: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
	assets: z
		.array(
			z.object({
				name: z.string().min(1),
				browser_download_url: z.string().min(1),
			}),
		)
		.optional(),
})
export type GithubReleasePayload = z.infer<typeof githubReleasePayload>

export type MarketLatest = {
	/** Raw release tag, e.g. `v1.2.3-beta.1`. */
	readonly tag: string
	/** Tag with the leading `v` stripped — the version shown for comparisons. */
	readonly version: string
	readonly releaseUrl: string
	readonly publishedAt: string | null
	/** Release body, truncated. */
	readonly notes: string | null
	/**
	 * Present when the release payload was fetched (installable/updatable).
	 * Absent on a rate-limited *version-only* entry: the version/tag came from
	 * the free `releases.atom` feed, but the asset could not be fetched, so
	 * install/update is blocked until the API recovers.
	 */
	readonly assetName?: string
	readonly assetUrl?: string
	/** Contents of the `<asset>.sha256` sidecar, when the release ships one. */
	readonly sha256?: string
	/**
	 * The release's `intro.<locale>.md` assets — the author-published,
	 * version-pinned plugin introduction, locale → markdown. Absent when
	 * the release ships none.
	 */
	readonly intro?: Readonly<Record<string, string>>
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
	readonly state: "ok" | "no_release" | "error"
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
	 * the free `releases.atom` feed after the GitHub API rate limit hit —
	 * `state` stays `ok` (data is usable) but the release info may be stale
	 * or, for a version-only entry, not installable; the UI flags it on the
	 * card and notes a new version may be waiting.
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

export type MarketInstallInput = {
	readonly id: string
	/** Normalized `owner/repo` the plugin is installed from — later the
	    update source remembered across registry switches. */
	readonly repo: string
	readonly assetUrl: string
	readonly sha256?: string
}
