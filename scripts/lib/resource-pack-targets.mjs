/**
 * Single policy table for the resource-pack update channel.
 *
 * Every build-side decision about which platform/arch ships a resource
 * pack — or which pack gets uploaded to the GitHub Release draft —
 * reads this table. The client mirrors the runtime side of the policy
 * in `apps/desktop/src/main/resource-support.ts`; keep the two in sync.
 *
 * Adding a platform later is one entry here plus the matching runner in
 * `.github/workflows/release.yml` (which runs the shared
 * `.github/actions/desktop-package` action) — no script changes.
 */

export const RESOURCE_PACK_TARGETS = {
	win32: { arch: "x64", slug: "win" },
	linux: { arch: "x64", slug: "linux" },
	darwin: { arch: "arm64", slug: "mac" },
}

/**
 * Which targets upload their pack to the release draft. Every supported
 * target still BUILDS + verifies its pack (format regression coverage);
 * only the upload policy gates what actually ships.
 */
export const PACK_UPLOAD = { win32: true, linux: false, darwin: false }

/** Accept the same aliases as verify-package.mjs: `mac` → `darwin`, `win` → `win32`. */
export function normalizeTarget(value) {
	if (value === "win" || value === "win32") return "win32"
	if (value === "linux") return "linux"
	if (value === "mac" || value === "darwin") return "darwin"
	return value
}

/**
 * Resolve a supported target for the given platform, falling back to the
 * matrix arch when none is passed. Returns `undefined` for unsupported
 * platforms.
 */
export function resolvePackTarget(platform, arch) {
	const target = RESOURCE_PACK_TARGETS[platform]
	if (target === undefined) return undefined
	return { platform, arch: arch ?? target.arch, slug: target.slug }
}

/** Artifact names: `resources-pack-<slug>-<arch>.{json,tar.gz}`. */
export function packFileNames(target) {
	const stem = `resources-pack-${target.slug}-${target.arch}`
	return { stem, manifest: `${stem}.json`, payload: `${stem}.tar.gz` }
}

/**
 * Top-level entries the pack carries — exactly the staged dirs the shell
 * swaps in place, plus the resources-version marker. Must match
 * SWAP_ENTRIES in apps/desktop/src/main/resources-swap.ts.
 */
export const RESOURCE_PACK_ENTRIES = [
	"node",
	"server",
	"plugins",
	"resources-version.json",
]
