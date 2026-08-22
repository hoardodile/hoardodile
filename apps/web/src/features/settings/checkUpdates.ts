import { compare } from "semver"
import { APP_RELEASES_API_URL, APP_REPOSITORY_URL } from "@/lib/appInfo"

export type UpdateCheckResult =
	| { readonly status: "latest" }
	| {
			readonly status: "outdated"
			readonly version: string
			readonly url: string
	  }
	| { readonly status: "error" }

/**
 * Comparator for semver strings; a leading `v` and missing trailing
 * segments are tolerated (`v1.2` === `1.2.0`). Prerelease ordering follows
 * semver precedence (`1.0.0-alpha` < `1.0.0-alpha.1` < `1.0.0-beta` <
 * `1.0.0`). Throws on versions that are not semver at all.
 */
export function compareVersions(a: string, b: string): number {
	return compare(padCoreVersion(a), padCoreVersion(b), { loose: true })
}

/** Fill missing major/minor/patch segments (`1.2` → `1.2.0`), keeping any prerelease suffix. */
function padCoreVersion(v: string): string {
	const [first, ...rest] = v.replace(/^v/, "").split("-")
	const segments = (first ?? "").split(".")
	while (segments.length < 3) segments.push("0")
	const padded = segments.join(".")
	return rest.length > 0 ? `${padded}-${rest.join("-")}` : padded
}

/**
 * Fetch the latest GitHub release and compare it against the running
 * version. Browser-direct call (api.github.com allows CORS); invoked only
 * on an explicit user action from the About section — never automatically.
 */
export async function checkForUpdate(
	current: string,
): Promise<UpdateCheckResult> {
	let data: unknown
	try {
		const res = await fetch(APP_RELEASES_API_URL)
		if (!res.ok) return { status: "error" }
		data = await res.json()
	} catch {
		return { status: "error" }
	}

	if (
		typeof data !== "object" ||
		data === null ||
		!("tag_name" in data) ||
		typeof data.tag_name !== "string"
	) {
		return { status: "error" }
	}

	const latest = data.tag_name.replace(/^v/, "")
	if (latest.length === 0) return { status: "error" }
	try {
		if (compareVersions(latest, current) <= 0) return { status: "latest" }
	} catch {
		// Tag is not a semver version (e.g. "latest"): cannot compare.
		return { status: "error" }
	}

	const url =
		"html_url" in data && typeof data.html_url === "string"
			? data.html_url
			: `${APP_REPOSITORY_URL}/releases`
	return { status: "outdated", version: latest, url }
}
