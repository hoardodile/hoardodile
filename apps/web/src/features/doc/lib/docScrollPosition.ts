/**
 * Per-document reading position, persisted as a single localStorage slot.
 *
 * Only the most recently opened document's position is kept: opening a
 * different document overwrites the slot (the previous one is discarded),
 * and a doc whose `docId` no longer matches the slot restores from the
 * top. Deliberately not routed through `prefSync` — scroll state is
 * ephemeral and must not be queued for server sync.
 */

import { prefKeys } from "@/lib/keys"

export type DocScrollPosition = {
	readonly docId: string
	/** The `data-id` of the block sitting on the reading anchor line. */
	readonly blockId: string
	/** Distance from the reading anchor line to the block top, in px. */
	readonly offset: number
	readonly updatedAtMs: number
}

export function readDocScrollPosition(): DocScrollPosition | undefined {
	try {
		const raw = localStorage.getItem(prefKeys.docLastScroll)
		if (raw === null) return undefined
		return parseDocScrollPosition(JSON.parse(raw))
	} catch {
		return undefined
	}
}

export function writeDocScrollPosition(position: DocScrollPosition): void {
	try {
		localStorage.setItem(prefKeys.docLastScroll, JSON.stringify(position))
	} catch {
		// Quota / privacy-mode errors: best-effort only.
	}
}

function parseDocScrollPosition(value: unknown): DocScrollPosition | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const candidate = value as Record<string, unknown>
	if (
		typeof candidate.docId !== "string" ||
		typeof candidate.blockId !== "string" ||
		typeof candidate.offset !== "number" ||
		typeof candidate.updatedAtMs !== "number"
	) {
		return undefined
	}
	return {
		docId: candidate.docId,
		blockId: candidate.blockId,
		offset: candidate.offset,
		updatedAtMs: candidate.updatedAtMs,
	}
}
