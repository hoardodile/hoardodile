/**
 * The published package inventory, derived from scripts/lib/release-packages.mjs
 * so the two can never drift: the release table is the single source for the
 * publish set, and this module carves it into the subsets the SDK tooling
 * cares about.
 *
 * Consumed by `scripts/gen-sdk-deps.mjs` (scaffold dependency list) and
 * `scripts/pack-sdks.mjs` (tarball packing + closure validation).
 */

import {
	PUBLISHED_PACKAGE_DIRS,
	PUBLISHED_PACKAGE_NAMES,
} from "./release-packages.mjs"

/** Workspace directory of each published package, keyed by package name. */
export const PACKAGE_DIRS = PUBLISHED_PACKAGE_DIRS

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
 * Everything published: the SDK closure plus the terminal packages (the
 * app-side runtime host, the dev tooling and the scaffolder). Terminal
 * packages may depend on the SDK but are never imported by plugin code.
 */
export const RELEASE_SET = new Set(PUBLISHED_PACKAGE_NAMES)

/** Workspace dirs of the SDK closure packages, for packing. */
export const SDK_PACKAGE_DIRS = [...SDK_CLOSURE].map(
	(name) => PACKAGE_DIRS[name],
)

/** Workspace dirs of the non-SDK published packages, for packing. */
export const TERMINAL_PACKAGE_DIRS = [...RELEASE_SET]
	.filter((name) => !SDK_CLOSURE.has(name))
	.map((name) => PACKAGE_DIRS[name])
