import type { DocNode } from "@hoardodile/schemas"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { isNotFoundError } from "../offline/errors"

export type UseDocDeletedExitInput = {
	readonly docId: string
	/** The detail-page query is still on its first load. */
	readonly isLoading: boolean
	/** The loaded node (`undefined` while loading or when it never resolved). */
	readonly node: DocNode | undefined
	/** The detail-page query error, when the last fetch failed. */
	readonly error: unknown
}

/**
 * Leaves the document page when the document stops existing *while the
 * user is looking at it*: soft-deleted from the tree (the row survives
 * with `deletedAt`), or hard-deleted (the server answers `NOT_FOUND`
 * while React Query still holds the last successful payload, so `node`
 * alone cannot tell us).
 *
 * Deliberately transition-based, not state-based: a document that is
 * already deleted when the page mounts — opened from the recycle bin, or
 * reached through a stale link — must keep rendering (read-only trash
 * preview / the not-found panel) instead of bouncing the user away.
 */
export function useDocDeletedExit(input: UseDocDeletedExitInput): {
	readonly gone: boolean
} {
	const { docId, isLoading, node, error } = input
	const navigate = useNavigate()
	const [gone, setGone] = useState(false)

	// Has this document ever been resolved during this mount, and was it
	// live at that point? Reset per document so a switch never inherits the
	// previous document's history — the reset effect is declared first, so
	// it always runs before the effect that reads these flags below.
	const resolvedRef = useRef(false)
	const liveRef = useRef(false)
	useEffect(
		function resetForDocument() {
			resolvedRef.current = false
			liveRef.current = false
			setGone(false)
		},
		[docId],
	)

	useEffect(
		function detectDeletion() {
			if (isLoading) return
			if (node !== undefined) {
				resolvedRef.current = true
				if (node.deletedAt == null) liveRef.current = true
			}
			const deletedUnderUser =
				node !== undefined && node.deletedAt != null && liveRef.current
			const destroyedUnderUser = isNotFoundError(error) && resolvedRef.current
			setGone(deletedUnderUser || destroyedUnderUser)
		},
		[docId, isLoading, node, error],
	)

	useEffect(
		function leaveDeletedDocument() {
			if (!gone) return
			// `replace` keeps the dead document URL out of history so Back
			// cannot land on it again.
			void navigate({ to: "/documents", replace: true })
		},
		[gone, navigate],
	)

	return { gone }
}
