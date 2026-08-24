declare const __APP_VERSION__: string

/**
 * Unified app version, injected at build time from the root package.json
 * via the `__APP_VERSION__` define in vite.config.ts (also active in Vitest,
 * which shares that config).
 */
export const APP_VERSION = __APP_VERSION__

/** Public source repository — linked from the About section. */
export const APP_REPOSITORY_URL = "https://github.com/hoardodile/hoardodile"

/** Official website — linked from the About section (not live yet). */
export const APP_WEBSITE_URL = "https://www.hoardodile.com"

/** Developer profile — linked from the About section. */
export const APP_DEVELOPER_URL = "https://github.com/wooloo26"
export const APP_DEVELOPER_NAME = "wooloo26"

/** Feedback destinations — the repo's issue templates (bug is split per deployment context). */
export const APP_ISSUES_BUG_DESKTOP_URL = `${APP_REPOSITORY_URL}/issues/new?template=bug_report_desktop.yml`
export const APP_ISSUES_BUG_SELFHOSTED_URL = `${APP_REPOSITORY_URL}/issues/new?template=bug_report_selfhosted.yml`
export const APP_ISSUES_FEATURE_URL = `${APP_REPOSITORY_URL}/issues/new?template=feature_request.yml`

/** GitHub API endpoint for the latest release (CORS-open, no token needed). */
export const APP_RELEASES_API_URL =
	"https://api.github.com/repos/hoardodile/hoardodile/releases/latest"
