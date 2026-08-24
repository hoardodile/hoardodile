/**
 * Single source of truth for the published plugin SDK package names and
 * their workspace directories. Consumed by `scripts/gen-sdk-deps.mjs`
 * (scaffold dependency list) and `scripts/pack-sdks.mjs` (tarball packing
 * + closure validation) so neither drifts from the published closure.
 */

/** Workspace directory of each published package, keyed by package name. */
export const PACKAGE_DIRS = {
	"@hoardodile/i18n": "packages/i18n",
	"@hoardodile/ui": "packages/ui",
	"@hoardodile/sdk-types": "plugins/sdk-types",
	"@hoardodile/sdk-web": "plugins/sdk-web",
	"@hoardodile/sdk-react": "plugins/sdk-react",
	"@hoardodile/sdk-server": "plugins/sdk-server",
	"@hoardodile/cli": "packages/cli",
	"@hoardodile/host": "plugins/host",
	"@hoardodile/host-web": "plugins/host-web",
	"@hoardodile/workbench": "plugins/workbench",
}

/**
 * The dependency-closed authoring SDK. A plugin's runtime code only ever
 * imports these (plus third-party packages) — no `@hoardodile` dependency
 * outside the set. `sdks:pack` enforces this.
 */
export const SDK_CLOSURE = new Set([
	"@hoardodile/i18n",
	"@hoardodile/ui",
	"@hoardodile/sdk-types",
	"@hoardodile/sdk-web",
	"@hoardodile/sdk-react",
	"@hoardodile/sdk-server",
])

/**
 * Everything published and packable: the SDK closure plus the terminal
 * packages (the app-side runtime host and the dev tooling). Terminal
 * packages may depend on the SDK but are never imported by plugin code;
 * scaffolded plugins declare their tarballs.
 */
export const RELEASE_SET = new Set([
	...SDK_CLOSURE,
	"@hoardodile/cli",
	"@hoardodile/host",
	"@hoardodile/host-web",
	"@hoardodile/workbench",
])

/** Workspace dirs of the SDK closure packages, for packing. */
export const SDK_PACKAGE_DIRS = [...SDK_CLOSURE].map(
	(name) => PACKAGE_DIRS[name],
)

/** Workspace dirs of the terminal packages, for packing. */
export const TERMINAL_PACKAGE_DIRS = [...RELEASE_SET]
	.filter((name) => !SDK_CLOSURE.has(name))
	.map((name) => PACKAGE_DIRS[name])
