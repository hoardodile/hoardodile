import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { useCallback, useEffect, useState } from "react"
import { useStringPrefSync } from "@/hooks/usePrefSync"
import { APP_VERSION } from "@/lib/appInfo"
import { getDesktopBridge } from "@/lib/desktop"
import { prefKeys } from "@/lib/keys"
import { isNewer } from "@/lib/versions"

/**
 * Subscribe to the desktop updater state. Every consumer (banner row,
 * About section, the availability badge) shares one subscription instead
 * of each re-plumbing `status()`/`onStatus`. Returns `undefined` in a
 * plain browser tab (no desktop bridge), where updater UI must not render.
 */
export function useDesktopUpdateState(): DesktopUpdateState | undefined {
	const desktop = getDesktopBridge()
	const [state, setState] = useState<DesktopUpdateState>({ status: "idle" })

	useEffect(() => {
		if (desktop === undefined) return
		void desktop.updates.status().then(setState)
		return desktop.updates.onStatus(setState)
	}, [desktop])

	if (desktop === undefined) return undefined
	return state
}

/**
 * Pure dot decision: is there a version newer than the running app that the
 * user has not already seen? `lastSeen` empty (or un-set) means everything
 * is unseen; non-semver versions compare as "not newer" (never a dot, never
 * a crash). Extracted from the hook so every edge case is unit-testable.
 */
export function computeUpdateAvailable(
	state: DesktopUpdateState | undefined,
	current: string,
	lastSeen: string,
): { readonly version: string | undefined; readonly available: boolean } {
	// An empty pref (never seen anything) means "everything is unseen".
	const lastSeenVersion = lastSeen.length > 0 ? lastSeen : "0.0.0"
	const version =
		state?.status === "available" || state?.status === "ready"
			? state.version
			: undefined
	const available =
		version !== undefined &&
		isNewer(version, current) &&
		isNewer(version, lastSeenVersion)
	return { version, available }
}

/**
 * The "update available" badge: a newer, unacknowledged version exists.
 * Clears once the user opens About (`markUpdateSeen`) and only re-arms
 * for a version strictly newer than the last seen one, so a single new
 * release never re-badges after being looked at.
 */
export function useUpdateAvailable(): {
	readonly state: DesktopUpdateState | undefined
	readonly available: boolean
	readonly version: string | undefined
	readonly markUpdateSeen: (version: string) => void
} {
	const state = useDesktopUpdateState()
	const [lastSeen, setLastSeen] = useStringPrefSync(
		prefKeys.updateLastSeenVersion,
		"",
	)
	const { version, available } = computeUpdateAvailable(
		state,
		APP_VERSION,
		lastSeen,
	)
	const markUpdateSeen = useCallback(
		(next: string) => setLastSeen(next),
		[setLastSeen],
	)
	return {
		state,
		available,
		version,
		markUpdateSeen,
	}
}
