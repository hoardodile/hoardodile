import type {
	AnchorData,
	HostPushes,
	InvalidateTarget,
} from "@hoardodile/sdk-web"
import { hostPushKeys, invalidatePushKeys } from "@hoardodile/sdk-web"
import {
	broadcastToAll,
	broadcastToResource,
	broadcastToSubscribers,
} from "./iframe-registry"

/**
 * The single typed entry point for every host→iframe push. Callers pick a
 * helper here instead of assembling `HostPush` objects against the pool's
 * broadcast primitives; the wire keys and payload shapes come from the SDK
 * protocol table ({@link HostPushes}).
 */

/** Tells every plugin iframe which theme is now active. */
export function pushThemeChanged(theme: HostPushes["themeChanged"]): void {
	broadcastToAll({ type: "push", key: hostPushKeys.themeChanged, data: theme })
}

/**
 * Tells plugin iframes which app font is now active. Iframes whose plugin
 * manifest opted out of font inheritance (`ui.inheritFont: false`) are
 * skipped — the `inheritFont` predicate receives the bound plugin id.
 */
export function pushFontsChanged(
	fonts: HostPushes["fontsChanged"],
	inheritFont: (pluginId: string) => boolean,
): void {
	broadcastToAll(
		{ type: "push", key: hostPushKeys.fontsChanged, data: fonts },
		(record) => inheritFont(record.pluginId),
	)
}

/**
 * Tells every plugin iframe the UI language changed. The payload is a bare
 * language-code string — the wire predates the typed protocol table, keep
 * it stable for already-installed plugin builds.
 */
export function pushLanguageChanged(language: string): void {
	broadcastToAll({
		type: "push",
		key: hostPushKeys.languageChanged,
		data: language,
	})
}

/**
 * Tells every plugin iframe that plugin-scoped prefs changed. With a
 * payload it carries the single changed entry; without one it means a bulk
 * reset and plugins should drop their whole pref store.
 */
export function pushPrefsChanged(payload?: HostPushes["prefsChanged"]): void {
	broadcastToAll({
		type: "push",
		key: hostPushKeys.prefsChanged,
		data: payload,
	})
}

/**
 * Tells every plugin iframe that plugin+resource cache entries changed.
 * With a payload it carries the single changed entry; without one it means
 * a bulk clear and plugins should drop their whole cache store.
 */
export function pushCacheChanged(payload?: HostPushes["cacheChanged"]): void {
	broadcastToAll({
		type: "push",
		key: hostPushKeys.cacheChanged,
		data: payload,
	})
}

/**
 * Asks the iframes bound to `resId` to jump to the given anchor (e.g. the
 * user clicked a comment anchor in the host UI).
 */
export function pushAnchorJump(resId: string, anchorData: AnchorData): void {
	broadcastToResource(resId, {
		type: "push",
		key: hostPushKeys.anchorJump,
		data: anchorData,
	})
}

/**
 * Broadcasts the `*:invalidate` push that matches an invalidated target, so
 * plugin-side query hooks (`useFileList`/`useMessageList`/`useDanmakuList`)
 * refetch. Resource-scoped targets go only to the iframes bound to `resId`;
 * the global `resources` target goes to every subscribed iframe.
 */
export function pushInvalidated(resId: string, target: InvalidateTarget): void {
	if (target === "resources") {
		broadcastToSubscribers(invalidatePushKeys.resources)
		return
	}
	broadcastToResource(resId, {
		type: "push",
		key: invalidatePushKeys[target],
	})
}
