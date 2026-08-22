/**
 * Single source of truth for the versioned release manifests: the in-repo
 * plugin manifests (file builtin + official seeds) and the published
 * package.json files that must all carry the app version from the root
 * package.json.
 *
 * Consumed by `scripts/sync-version.mjs` (release-it after:bump) and
 * `scripts/check-version-sync.mjs` (CI + pre-push) so the two never drift —
 * same pattern as `scripts/lib/sdk-closure.mjs`.
 */

/** In-repo plugin manifests (file builtin + official seeds, not published). */
export const PLUGIN_MANIFESTS = [
	"plugins/file/manifest.json",
	"plugins/gallery/manifest.json",
]

/** The published package.json files (SDK closure + terminal packages). */
export const PUBLISHED_PACKAGE_MANIFESTS = [
	"packages/cli/package.json",
	"packages/ui/package.json",
	"plugins/host/package.json",
	"plugins/host-web/package.json",
	"plugins/sdk-types/package.json",
	"plugins/sdk-web/package.json",
	"plugins/sdk-react/package.json",
	"plugins/sdk-server/package.json",
	"plugins/workbench/package.json",
	"plugins/create-plugin/package.json",
]
