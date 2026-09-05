import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { notFound } from "../errors.ts"

/**
 * Persisted version-state file (under `<root>/local/`, not `versions/`,
 * because `versions/` is reserved for version folders only).
 */
const STATE_FILENAME = "version-state.json"

/**
 * On-disk shape of the version state.
 *
 * - `active` — the version the user is currently viewing. When `active`
 *   equals the current (max) version the server runs in normal R/W mode;
 *   when `active < current` the server runs READ-ONLY against a cloned
 *   snapshot of the active version's DB.
 */
type VersionState = {
	readonly active: number
}

/** Root layout helper: the versions root directory `<root>/versions`. */
function versionsRoot(root: string): string {
	return resolve(root, "versions")
}

/** State file lives under `<root>/local/version-state.json`. */
function stateFile(root: string): string {
	return resolve(root, "local", STATE_FILENAME)
}

/**
 * Enumerate version directories under `<root>/versions/`. Names that are
 * not pure positive integers are ignored. Result is sorted ascending.
 */
export function listVersions(root: string): readonly number[] {
	const dir = versionsRoot(root)
	if (!existsSync(dir)) return []
	const names = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
	const nums: number[] = []
	for (const n of names) {
		if (!/^[1-9][0-9]*$/.test(n)) continue
		nums.push(Number.parseInt(n, 10))
	}
	nums.sort((a, b) => a - b)
	return nums
}

/**
 * Current (maximum) version on disk. Returns `0` when no version exists
 * yet (caller is expected to bootstrap version 1 in that case).
 */
export function currentVersion(root: string): number {
	const all = listVersions(root)
	return all.length === 0 ? 0 : (all[all.length - 1] ?? 0)
}

/**
 * Read the persisted active version. Falls back to current when the
 * state file is missing or malformed, or when the recorded value points
 * at a version that no longer exists.
 */
export function readActiveVersion(root: string): number {
	const cur = currentVersion(root)
	const file = stateFile(root)
	if (!existsSync(file)) return cur
	try {
		const parsed = JSON.parse(
			readFileSync(file, "utf8"),
		) as Partial<VersionState>
		const active = typeof parsed.active === "number" ? parsed.active : cur
		const all = listVersions(root)
		if (all.includes(active)) return active
		return cur
	} catch {
		return cur
	}
}

/**
 * Persist the active version. Caller must ensure `version` exists on
 * disk (use {@link listVersions}).
 *
 * @throws DomainError `version.not_found` when `version` is not a known
 *   version directory.
 */
export function writeActiveVersion(root: string, version: number): void {
	const all = listVersions(root)
	if (!all.includes(version)) {
		throw notFound("version.not_found", `version ${version} does not exist`, {
			version,
		})
	}
	const file = stateFile(root)
	mkdirSync(resolve(root, "local"), { recursive: true })
	const payload: VersionState = { active: version }
	writeFileSync(file, JSON.stringify(payload), "utf8")
}

/**
 * Bootstrap version 1 if the versions root has no version directories yet.
 * Idempotent; a no-op when any version already exists.
 */
export function ensureBootstrapVersion(root: string): number {
	const cur = currentVersion(root)
	if (cur > 0) return cur
	const v1 = resolve(versionsRoot(root), "1")
	mkdirSync(v1, { recursive: true })
	return 1
}

/**
 * Path to the DB file for version `v`: `<root>/versions/<v>/app.sqlite`.
 */
export function versionedDbFile(root: string, v: number): string {
	return resolve(versionsRoot(root), String(v), "app.sqlite")
}

/**
 * Path to the per-version archive directory `<root>/versions/<v>`.
 */
export function versionedPath(root: string, v: number): string {
	return resolve(versionsRoot(root), String(v))
}
