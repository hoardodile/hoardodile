import type { Host, HostPushes } from "./protocol.ts"

/** Structural port shared with the UI provider; no React dependency in this SDK. */
type Overlay = {
	readonly id: string
	readonly parentId?: string
	readonly isOpen: () => boolean
	readonly close: () => void
}
export type OverlayRegistry = {
	readonly set: (entry: Overlay) => void
	readonly remove: (id: string) => void
}
type Entry = { overlay: Overlay; present: boolean; wireId?: string }

/** The iframe only sends UI state. It never reads or writes session history. */
export function createIframeOverlayRegistry(host: Host) {
	const entries = new Map<string, Entry>()
	let scoped = host
	let resId = ""
	let session: string | undefined
	let sequence = 0
	let revision = 0
	let scheduled = false
	let disposed = false

	function sync() {
		scheduled = false
		if (disposed) return
		for (const [id, entry] of entries) {
			if (!entry.present || !entry.overlay.isOpen()) entries.delete(id)
			else entry.wireId ??= `${id}:${++sequence}`
		}
		if (session === undefined) return
		const overlays = [...entries.values()].flatMap((entry) => {
			if (entry.wireId === undefined) return []
			const parentId =
				entry.overlay.parentId === undefined
					? undefined
					: entries.get(entry.overlay.parentId)?.wireId
			return [{ id: entry.wireId, parentId }]
		})
		const sentSession = session
		void scoped
			.request("overlaySync", { session, revision: ++revision, overlays })
			.then((reply) => {
				if (session === sentSession && reply?.accepted !== true)
					session = undefined
			})
			.catch(() => {
				// An old/unavailable host leaves ordinary UI close controls usable.
				if (session === sentSession) session = undefined
			})
	}
	function schedule() {
		if (scheduled || disposed) return
		scheduled = true
		queueMicrotask(sync)
	}
	function reset(next: string | undefined) {
		if (session === next) return
		for (const entry of [...entries.values()].reverse()) {
			if (entry.present && entry.overlay.isOpen()) entry.overlay.close()
		}
		entries.clear()
		session = next
		revision = 0
		schedule()
	}
	const unsubClose = host.subscribe("overlayClose", (message) => {
		if (message.session !== session) return
		const entry = [...entries.values()].find(
			(item) => item.wireId === message.id,
		)
		if (entry === undefined || !entry.present) return
		entry.overlay.close()
		schedule() // A refused close is acknowledged by the unchanged snapshot.
	})
	const unsubSession = host.subscribe(
		"overlaySession",
		(message: HostPushes["overlaySession"]) => {
			if (message.resId === resId) reset(message.session)
		},
	)
	return {
		set(overlay: Overlay) {
			const entry = entries.get(overlay.id)
			if (entry === undefined)
				entries.set(overlay.id, { overlay, present: true })
			else {
				entry.overlay = overlay
				entry.present = true
			}
			schedule()
		},
		remove(id: string) {
			const entry = entries.get(id)
			if (entry !== undefined) entry.present = false
			schedule()
		},
		configure(context: {
			readonly resId: string
			readonly overlaySession?: string
		}) {
			resId = context.resId
			scoped = host.withScope(resId)
			reset(context.overlaySession)
		},
		dispose() {
			disposed = true
			unsubClose()
			unsubSession()
			entries.clear()
		},
	}
}
