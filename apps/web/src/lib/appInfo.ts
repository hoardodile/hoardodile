declare const __APP_VERSION__: string

/**
 * Unified app version, injected at build time from the root package.json
 * via the `__APP_VERSION__` define in vite.config.ts (also active in Vitest,
 * which shares that config).
 */
export const APP_VERSION = __APP_VERSION__

/** Public source repository — linked from the About section. */
export const APP_REPOSITORY_URL = "https://github.com/hoardodile/hoardodile"

/** GitHub API endpoint for the latest release (CORS-open, no token needed). */
export const APP_RELEASES_API_URL =
	"https://api.github.com/repos/hoardodile/hoardodile/releases/latest"
