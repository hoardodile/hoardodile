/**
 * Single-active-media coordinator shared by the card's inline video and
 * audio players.
 *
 * Only one card may be playing at a time. A generation counter tracks
 * which instance is currently active so that a stale pointerleave from
 * the previous card (which can fire after the new card's pointerenter
 * when the mouse moves quickly between cards) cannot tear down the new
 * card's playback. Tab visibility loss stops the active one (browsers
 * otherwise pause the element but our `isPlaying` state lingered,
 * blocking re-play when the user returned to the tab).
 */

let activeStop: (() => void) | undefined
let activeGeneration = 0

/**
 * Claim the single playback slot, stopping whoever held it, and return
 * the generation token the caller keeps to detect a later takeover.
 */
export function activatePlayback(stop: () => void): number {
	if (activeStop !== undefined && activeStop !== stop) activeStop()
	const gen = ++activeGeneration
	activeStop = stop
	return gen
}

/** True while `generation` still owns the playback slot. */
export function ownsPlayback(generation: number): boolean {
	return generation === activeGeneration
}

/**
 * Stop whichever card is currently playing. Called on pointerleave, on
 * tab hide, and before opening the full preview dialog so the now-hidden
 * media does not keep decoding behind the lightbox.
 */
export function stopActiveMediaPreview(): void {
	if (activeStop !== undefined) {
		activeStop()
		activeStop = undefined
		activeGeneration++
	}
}

let visibilityListenerAttached = false

/** Attach the one-time visibilitychange listener that parks playback. */
export function ensureVisibilityListener(): void {
	if (visibilityListenerAttached) return
	if (typeof document === "undefined") return
	visibilityListenerAttached = true
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) stopActiveMediaPreview()
	})
}
