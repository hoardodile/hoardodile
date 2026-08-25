/**
 * Single source of truth for the versioned release manifests: the in-repo
 * plugin manifests (file builtin + seed plugins) and the published
 * package.json files that must all carry the app version from the root
 * package.json.
 *
 * Consumed by `scripts/sync-version.mjs` (release-it after:bump),
 * `scripts/check-version-sync.mjs` (CI + pre-push), `scripts/sdk-closure.mjs`
 * (published set derivation), and `scripts/publish-release-set.mjs` — the
 * published table below is the one place a package joins the release set.
 */

/** In-repo plugin manifests (file builtin + seed plugins, not published). */
export const PLUGIN_MANIFESTS = [
	"plugins/file/manifest.json",
	"plugins/gallery/manifest.json",
	"plugins/pdf/manifest.json",
]

/** The published SDK release set: package name → workspace dir. */
export const PUBLISHED_PACKAGES = [
	{ name: "@hoardodile/cli", dir: "packages/cli" },
	{ name: "@hoardodile/create-plugin", dir: "plugins/create-plugin" },
	{ name: "@hoardodile/host", dir: "plugins/host" },
	{ name: "@hoardodile/host-web", dir: "plugins/host-web" },
	{ name: "@hoardodile/i18n", dir: "packages/i18n" },
	{ name: "@hoardodile/sdk-react", dir: "plugins/sdk-react" },
	{ name: "@hoardodile/sdk-server", dir: "plugins/sdk-server" },
	{ name: "@hoardodile/sdk-types", dir: "plugins/sdk-types" },
	{ name: "@hoardodile/sdk-web", dir: "plugins/sdk-web" },
	{ name: "@hoardodile/ui", dir: "packages/ui" },
	{ name: "@hoardodile/workbench", dir: "plugins/workbench" },
]

export const PUBLISHED_PACKAGE_MANIFESTS = PUBLISHED_PACKAGES.map(
	(pkg) => `${pkg.dir}/package.json`,
)

export const PUBLISHED_PACKAGE_NAMES = PUBLISHED_PACKAGES.map((pkg) => pkg.name)

export const PUBLISHED_PACKAGE_DIRS = Object.fromEntries(
	PUBLISHED_PACKAGES.map((pkg) => [pkg.name, pkg.dir]),
)
