import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Absolute workspace root, resolved from this module's own location so
 * every script can run from any cwd.
 */
export const WORKSPACE_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
)

/** Resolve a path under the gitignored `tmp/` dir of the workspace root. */
export function tmpPath(...parts) {
	return join(WORKSPACE_ROOT, "tmp", ...parts)
}
