/** A registration is a live view of committed UI state, not a history entry. */
export type MobileBackOverlay = {
	readonly id: string
	readonly parentId?: string
	readonly isOpen: () => boolean
	readonly close: () => void
}

export type MobileBackRegistry = {
	readonly set: (overlay: MobileBackOverlay) => void
	readonly remove: (id: string) => void
}

type Entry = {
	overlay: MobileBackOverlay
	present: boolean
	token: string | undefined
	order: number
	retired: boolean
}

/**
 * Coalesces registrations before assigning activation identities. In particular,
 * StrictMode's remove + set does not create a second activation/history entry.
 * Parent-before-child ordering is explicit, including child-first React effects.
 */
export function createMobileBackStack() {
	const entries = new Map<string, Entry>()
	const instance = Math.random().toString(36).slice(2)
	let sequence = 0

	function active() {
		for (const [id, entry] of entries) {
			if (!entry.present) {
				entries.delete(id)
				continue
			}
			if (!entry.overlay.isOpen()) {
				entry.token = undefined
				entry.retired = false
			} else if (!entry.retired && entry.token === undefined) {
				entry.order = ++sequence
				entry.token = `${instance}:${id}:${sequence}`
			}
		}
		const ordered: Entry[] = []
		const visited = new Set<Entry>()
		function visit(entry: Entry) {
			if (visited.has(entry)) return
			visited.add(entry)
			const parentId = entry.overlay.parentId
			const parent = parentId === undefined ? undefined : entries.get(parentId)
			if (parent !== undefined) visit(parent)
			if (entry.present && entry.token !== undefined && !entry.retired)
				ordered.push(entry)
		}
		for (const entry of [...entries.values()].sort((a, b) => a.order - b.order))
			visit(entry)
		return ordered
	}

	return {
		set(overlay: MobileBackOverlay) {
			const entry = entries.get(overlay.id)
			if (entry !== undefined) {
				entry.overlay = overlay
				entry.present = true
			} else {
				entries.set(overlay.id, {
					overlay,
					present: true,
					token: undefined,
					order: ++sequence,
					retired: false,
				})
			}
		},
		remove(id: string) {
			const entry = entries.get(id)
			if (entry !== undefined) entry.present = false
		},
		tokens(): string[] {
			return active().flatMap((entry) =>
				entry.token === undefined ? [] : [entry.token],
			)
		},
		close(tokens: readonly string[], retire = false) {
			const targets = new Set(tokens)
			for (const entry of active().reverse()) {
				if (entry.token === undefined || !targets.has(entry.token)) continue
				// Retirement applies to navigation only. A refused back close keeps
				// its token and reconciliation restores its history protection.
				if (retire) entry.retired = true
				entry.overlay.close()
			}
		},
		clear() {
			entries.clear()
		},
		get size() {
			return entries.size
		},
	}
}
