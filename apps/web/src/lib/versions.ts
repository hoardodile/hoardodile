import { compare } from "semver"

/**
 * Comparator for semver strings; a leading `v` and missing trailing
 * segments are tolerated (`v1.2` === `1.2.0`). Prerelease ordering follows
 * semver precedence (`1.0.0-alpha` < `1.0.0-alpha.1` < `1.0.0-beta` <
 * `1.0.0`). Throws on versions that are not semver at all.
 */
export function compareVersions(a: string, b: string): number {
	return compare(padCoreVersion(a), padCoreVersion(b), { loose: true })
}

/**
 * True when `version` is newer than `installed` and both parse as
 * semver. Non-semver versions cannot be ranked — callers keep their
 * own displayed-verbatim handling.
 */
export function isNewer(version: string, installed: string): boolean {
	try {
		return compareVersions(version, installed) > 0
	} catch {
		return false
	}
}

/** Fill missing major/minor/patch segments (`1.2` → `1.2.0`), keeping any prerelease suffix. */
function padCoreVersion(v: string): string {
	const [first, ...rest] = v.replace(/^v/, "").split("-")
	const segments = (first ?? "").split(".")
	while (segments.length < 3) segments.push("0")
	const padded = segments.join(".")
	return rest.length > 0 ? `${padded}-${rest.join("-")}` : padded
}
