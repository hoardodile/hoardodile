import type { Resource } from "@hoardodile/schemas"
import type { PluginIframeContext } from "@hoardodile/sdk-web"
import { claim, type PoolClaimedEntry } from "./iframe-pool"

// Preview window: owns the pool claims for the focused preview resource
// and its ±1 neighbors so that a left/right switch is a pure compositor
// event. Every window resource gets its own iframe — claimed, context
// pushed, painted (acked), transparent but continuously laid out
// (display:block, opacity 0) and stacked over the preview placeholder.
// A switch is then only style writes (opacity/pointerEvents/zIndex) plus
// a visibility push, with no display toggling and no compositor-surface
// re-attach. This subsumes both the old held-slot transition machine
// (the previously presented slot stays on screen until its replacement
// is ready) and the predictive prerender (the resident window IS the
// prerender). Pure and React-free: the hook layer (use-iframe-slot.ts)
// drives focus/flipNow from effects and reads the snapshot through
// useSyncExternalStore.
//
// Memory bound: the window holds 3 claims normally, 4 once the user
// starts flipping in one direction (directional lookahead — the search
// dialog adds the slot two steps ahead). Four same-plugin entries
// exceed the pool's per-plugin bound (primary + 2 ephemerals), so the
// fourth claim evicts the LRU idle ephemeral and that slot degrades to
// the held behavior — acceptable, and rare outside uniform libraries.
// Non-presented slots receive setVisibility(false) so plugins pause
// media; their painted bitmaps are retained on purpose (that is what
// makes the flip free).

/**
 * The resource fields every plugin preview consumer passes down together.
 * Declared once here so the dialog, detail page, and slot hooks share a
 * single props shape instead of repeating the same six fields.
 */
export type PreviewTarget = {
	readonly resId: string
	readonly resName: string
	readonly contentPluginId: string
	readonly sourceMeta: Resource["sourceMeta"]
	readonly searchMeta?: Resource["searchMeta"]
	readonly fileStats?: Resource["fileStats"]
}

/** A ±1 neighbor of the focused resource, known by resId + plugin only. */
export type PreviewWindowNeighbor = {
	readonly resId: string
	readonly pluginId: string
}

/** The focused window item: full target fields for the context build. */
export type PreviewWindowItem = PreviewTarget & {
	readonly pluginId: string
}

export type PreviewWindowSlot = {
	readonly resId: string
	readonly pluginId: string
	readonly iframe: HTMLIFrameElement
	/** The claim handle, exposed so the lifecycle hook can subscribe to
	 * load/timeout on the focused slot. */
	readonly claim: PoolClaimedEntry
	/** The plugin painted (and acked) this slot's context. */
	readonly ready: boolean
	readonly presented: boolean
}

export type PreviewWindowSnapshot = {
	readonly focusedResId: string
	readonly presentedResId: string | null
	readonly slots: readonly PreviewWindowSlot[]
	readonly focusedReady: boolean
}

/** The same-frame flip handle the search dialog calls from click handlers. */
export type PreviewWindowFlip = {
	readonly flipNow: (resId: string) => boolean
}

export type PreviewWindow = {
	readonly focus: (
		item: PreviewWindowItem,
		neighbors: readonly PreviewWindowNeighbor[],
	) => void
	readonly flipNow: (resId: string) => boolean
	readonly subscribe: (cb: () => void) => () => void
	readonly getSnapshot: () => PreviewWindowSnapshot
	readonly dispose: () => void
}

/**
 * NEIGHBOR claims wait for the real paint ack far longer than the
 * user-facing 300ms pool fallback: a transparent iframe's rAF may be
 * throttled by Chrome (~1fps observed, so a double-rAF ack needs ~2s),
 * and the whole point of the window is that every background slot
 * reaches the genuinely-painted state. 5s doubles as the cleanup for
 * legacy SDKs that never ack. Focused claims do NOT use this: they are
 * user-facing and keep the pool's 300ms default (see addSlot), and a
 * neighbor promoted to focused gets a 300ms window-level fallback
 * (armFocusFallback) so no user-visible path ever waits seconds.
 */
const WINDOW_ACK_TIMEOUT_MS = 5_000

/**
 * User-facing readiness fallback for a focused-but-unpainted slot,
 * mirroring the pool's legacy-SDK fallback: present after this long
 * even without the ack. Presenting also un-throttles the iframe's rAF
 * (opacity 1 = visible), so the real paint accelerates rather than
 * being delayed further.
 */
const FOCUSED_READY_FALLBACK_MS = 300

type WindowSlotRecord = {
	readonly claim: PoolClaimedEntry
	readonly pluginId: string
	ready: boolean
	unsubReady: () => void
	focusFallbackTimer: ReturnType<typeof setTimeout> | undefined
}

export function createPreviewWindow(deps: {
	readonly getAssetVersion: (pluginId: string) => string | undefined
	readonly loadContext: (item: PreviewWindowItem) => Promise<{
		readonly ctx: PluginIframeContext
		readonly assetVersion?: string
	}>
	readonly loadNeighborContext: (neighbor: PreviewWindowNeighbor) => Promise<{
		readonly ctx: PluginIframeContext
		readonly assetVersion?: string
	}>
	/** zIndex for the presented iframe; every other slot gets zTop - 1. */
	readonly zTop: number
}): PreviewWindow {
	const { getAssetVersion, loadContext, loadNeighborContext, zTop } = deps

	const slots = new Map<string, WindowSlotRecord>()
	let focusedResId = ""
	let presentedResId: string | null = null
	// The resIds the last focus() call wanted (focused + neighbors). Slots
	// outside this set are released by the next sweep — except a presented
	// one, which is held on screen until its replacement is presented.
	let wanted = new Set<string>()
	const listeners = new Set<() => void>()

	// useSyncExternalStore requires a referentially stable snapshot between
	// notifications, so it is rebuilt only when the state actually changes.
	let snapshot = buildSnapshot()

	function buildSnapshot(): PreviewWindowSnapshot {
		const focused = slots.get(focusedResId)
		return {
			focusedResId,
			presentedResId,
			focusedReady: focused?.ready ?? false,
			slots: [...slots].map(([resId, slot]) => ({
				resId,
				pluginId: slot.pluginId,
				iframe: slot.claim.iframe,
				claim: slot.claim,
				ready: slot.ready,
				presented: resId === presentedResId,
			})),
		}
	}

	function notify(): void {
		snapshot = buildSnapshot()
		for (const cb of listeners) {
			cb()
		}
	}

	/**
	 * Writes the user-facing presentation of every slot: the presented
	 * iframe on top, opaque and interactive; all others transparent and
	 * inert one layer below. NEVER touches `display` — painted slots stay
	 * display:block (the geometry tracker owns display for the zero-rect
	 * case), so a flip never re-attaches a compositor surface. Also pushes
	 * visibility so plugins pause/resume media accordingly.
	 */
	function writePresentation(): void {
		for (const [resId, slot] of slots) {
			const presented = resId === presentedResId
			const style = slot.claim.iframe.style
			style.opacity = presented ? "1" : "0"
			style.pointerEvents = presented ? "auto" : "none"
			style.zIndex = presented ? String(zTop) : String(zTop - 1)
			slot.claim.setVisibility(presented)
		}
	}

	function removeSlot(resId: string, slot: WindowSlotRecord): void {
		slot.unsubReady()
		clearFocusFallback(slot)
		slot.claim.release()
		slots.delete(resId)
	}

	function clearFocusFallback(record: WindowSlotRecord): void {
		if (record.focusFallbackTimer !== undefined) {
			clearTimeout(record.focusFallbackTimer)
			record.focusFallbackTimer = undefined
		}
	}

	/**
	 * Present a focused slot after FOCUSED_READY_FALLBACK_MS even without
	 * the paint ack — the user-facing mirror of the pool's legacy-SDK
	 * fallback. A neighbor slot promoted to focused keeps its 5s
	 * background ack timer in the pool, but the user must never wait
	 * that long; the late ack is swallowed by the ready guard in
	 * addSlot's onReady.
	 */
	function armFocusFallback(resId: string, record: WindowSlotRecord): void {
		if (record.focusFallbackTimer !== undefined) return
		record.focusFallbackTimer = setTimeout(() => {
			record.focusFallbackTimer = undefined
			if (slots.get(resId) !== record || record.ready) return
			record.ready = true
			if (resId === focusedResId) {
				present(resId)
			} else {
				notify()
			}
		}, FOCUSED_READY_FALLBACK_MS)
	}

	/**
	 * Release every slot the last focus() no longer wants — except the
	 * presented one: it stays claimed and on screen (held) until its
	 * replacement has been presented, so the user never sees a gap.
	 * Returns whether anything was released.
	 */
	function sweep(): boolean {
		let released = false
		for (const [resId, slot] of [...slots]) {
			if (wanted.has(resId)) continue
			if (resId === presentedResId) continue
			removeSlot(resId, slot)
			released = true
		}
		return released
	}

	function present(resId: string): void {
		presentedResId = resId
		// The flip released the hold on the previously presented slot: if
		// it fell out of the window it can go back to the pool now — after
		// the new iframe's presentation writes, never before (an empty
		// frame otherwise).
		sweep()
		writePresentation()
		notify()
	}

	function addSlot(
		item: PreviewWindowItem | PreviewWindowNeighbor,
		isFocused: boolean,
	): void {
		const slotClaim = claim({
			pluginId: item.pluginId,
			assetVersion: getAssetVersion(item.pluginId),
			resId: item.resId,
			// Only background (neighbor) claims get the long ack window;
			// focused claims keep the pool's user-facing 300ms default.
			ackTimeoutMs: isFocused ? undefined : WINDOW_ACK_TIMEOUT_MS,
		})
		const record: WindowSlotRecord = {
			claim: slotClaim,
			pluginId: item.pluginId,
			ready: false,
			unsubReady: () => {},
			focusFallbackTimer: undefined,
		}
		slots.set(item.resId, record)

		if (slotClaim.primedResId === item.resId) {
			// Primed claim: the pooled entry already painted and acked
			// exactly this resId, so the context on screen is already
			// correct — no post, no ack wait.
			record.ready = true
			return
		}

		const contextRequest =
			isFocused && "resName" in item
				? loadContext(item)
				: loadNeighborContext(item)
		void (async function push() {
			try {
				// The context is posted only once both the iframe load and the
				// context data are in hand — posting into an unloaded document
				// would reach no listener.
				const [{ ctx, assetVersion }] = await Promise.all([
					contextRequest,
					slotClaim.whenLoaded(),
				])
				// A replaced/rebuild plugin must load its new bundle before
				// the context is posted. Same fingerprint: the hot reuse path,
				// no reload.
				if (assetVersion !== undefined && slotClaim.reloadAsset(assetVersion)) {
					await slotClaim.whenLoaded()
				}
				// The slot may have been released while the fetches were in
				// flight (window slid, dialog closed).
				if (slots.get(item.resId) !== record) return
				slotClaim.postContext(ctx)
			} catch {
				// Best-effort: a slot whose context cannot be built is
				// released silently; the switch falls back to nothing
				// prerendered for that resource.
				if (slots.get(item.resId) === record) {
					removeSlot(item.resId, record)
					notify()
				}
			}
		})()

		// onReady fires at most once and replays to late subscribers, so a
		// slot that readied before this subscription flips synchronously.
		record.unsubReady = slotClaim.onReady(() => {
			if (slots.get(item.resId) !== record) return
			clearFocusFallback(record)
			// Already presented via the user-facing focus fallback: the
			// late ack is a no-op (the paint it confirms is already on
			// screen by definition of the fallback having presented).
			if (record.ready) return
			record.ready = true
			if (item.resId === focusedResId) {
				present(item.resId)
			} else {
				notify()
			}
		})
	}

	function focus(
		item: PreviewWindowItem,
		neighbors: readonly PreviewWindowNeighbor[],
	): void {
		focusedResId = item.resId
		// Wanted = focused + neighbors, deduped by resId (the focused item
		// wins a collision: it carries the full context fields).
		const entries = new Map<string, PreviewWindowItem | PreviewWindowNeighbor>()
		entries.set(item.resId, item)
		for (const neighbor of neighbors) {
			if (!entries.has(neighbor.resId)) entries.set(neighbor.resId, neighbor)
		}
		wanted = new Set(entries.keys())

		// Claim every wanted resId that has no slot yet. A slot whose
		// pluginId no longer matches (same resId re-focused under a
		// different plugin) is stale and re-claimed. Slots that already
		// match are kept untouched — focusing an already-claimed resId is
		// cheap: no re-claim, no re-post.
		let changed = false
		for (const entry of entries.values()) {
			const existing = slots.get(entry.resId)
			if (existing !== undefined && existing.pluginId === entry.pluginId) {
				continue
			}
			if (existing !== undefined) {
				// Same resId under a different plugin: the slot is stale and
				// re-claimed below. If it was presented this exposes a brief
				// gap — acceptable on this path, which only occurs when a
				// resId changes plugin mid-dialog.
				removeSlot(entry.resId, existing)
				if (entry.resId === presentedResId) presentedResId = null
			}
			addSlot(entry, entry.resId === item.resId)
			changed = true
		}

		// If the focused slot is already painted (primed claim or an
		// already-acked neighbor), present it right away; otherwise the
		// previous presented slot stays on screen until the ack lands —
		// bounded by the user-facing fallback, so a neighbor promoted to
		// focused never makes the user wait out its 5s background timer.
		const focused = slots.get(item.resId)
		if (focused?.ready === true && presentedResId !== item.resId) {
			present(item.resId)
			return
		}
		if (focused !== undefined && !focused.ready) {
			armFocusFallback(item.resId, focused)
		}
		if (sweep()) changed = true
		// Idempotency matters: the hook re-runs focus whenever the
		// neighbors array identity changes, so a no-op focus must not
		// notify (a notify would re-render and loop) nor re-push
		// visibility (each push is a postMessage into the iframe).
		if (!changed) return
		writePresentation()
		notify()
	}

	function flipNow(resId: string): boolean {
		const slot = slots.get(resId)
		if (slot === undefined || !slot.ready) return false
		if (presentedResId !== resId) {
			present(resId)
		}
		return true
	}

	function subscribe(cb: () => void): () => void {
		listeners.add(cb)
		return () => {
			listeners.delete(cb)
		}
	}

	function getSnapshot(): PreviewWindowSnapshot {
		return snapshot
	}

	function dispose(): void {
		for (const [resId, slot] of [...slots]) {
			removeSlot(resId, slot)
		}
		presentedResId = null
		// No notify: dispose runs on unmount, when subscribers are gone —
		// but the cached snapshot must still reflect the cleared state.
		snapshot = buildSnapshot()
	}

	return { focus, flipNow, subscribe, getSnapshot, dispose }
}
