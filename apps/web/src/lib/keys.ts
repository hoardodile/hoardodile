/**
 * Cross-cutting key constants for apps/web.
 *
 * Values that appear in multiple features (localStorage, BroadcastChannel,
 * SW messages) are centralized here so they can't drift out of sync.
 * Plugin iframe wire keys live in `@hoardodile/sdk-web` instead —
 * that package owns the wire protocol.
 */

// ── Pref / localStorage keys ───────────────────────────────────────────────
// NOTE: `index.html` has a pre-hydration script that reads the same keys.
// If you change these literals you MUST update `index.html` as well.
export const prefKeys = {
	theme: "theme",
	themePalette: "themePalette",
	iconStyle: "icons.style",
	language: "language",
	appFont: "app.font",
	docEditorFont: "document.editorFont",
	docEditorFontInherit: "document.editorFontInherit",
	docUiFont: "document.uiFont",
	docUiFontInherit: "document.uiFontInherit",
	docUiHeadingFont: "document.uiHeadingFont",
	docUiHeadingFontInherit: "document.uiHeadingFontInherit",
	docTreeExpanded: "document.treeExpanded",
	docTheme: "document.theme",
	docLastOpened: "document.lastOpened",
	docLastScroll: "document.lastScroll",
	docReadingWidth: "document.readingWidth",
	colorPresets: "colorPicker.presets",
	overviewPinnedCharacters: "overview.pinned.characters",
	overviewPinnedResources: "overview.pinned.resources",
	overviewPinnedSeeds: "overview.pinned.seeds",
	dateFormat: "date.format",
	timeZone: "date.timeZone",
	privacyAutoLogoutEnabled: "privacy.autoLogoutEnabled",
	privacyAutoLogoutDelayMs: "privacy.autoLogoutDelayMs",
	authSessionIdleTimeoutSeconds: "auth.sessionIdleTimeoutSeconds",
	searchLive: "search.live",
	/**
	 * Desktop-only: the user has already seen the update at this version
	 * (opened About), so the update-available dot stays hidden until a
	 * strictly newer release arrives. Never written or read in the browser.
	 */
	updateLastSeenVersion: "update.lastSeenVersion",
	/**
	 * Desktop-only: the last resolved route, so a reopened window (tray /
	 * relaunch) returns to the page the user left. Never written or read
	 * in the browser.
	 */
	lastRoute: "app.lastRoute",
	/**
	 * Async-scope prefs (server-side, `asyncPreference` namespace) for the
	 * sync-device feature. `index.html` does not read these.
	 */
	syncRemindDays: "sync.remindDays",
} as const

export const signalPrefixes = {
	prefSync: "__bc:",
} as const

// ── BroadcastChannel names ─────────────────────────────────────────────────
export const channelNames = {
	prefSync: "hoardodile-prefsync",
	sseEvents: "hoardodile-sse-events",
	auth: "hoardodile-auth",
} as const

/** Web Locks API name — one exclusive holder per origin for `/api/events`. */
export const lockNames = {
	sse: "hoardodile-sse",
} as const
