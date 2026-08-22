import { useBlocker } from "@tanstack/react-router"
import { isEqual } from "es-toolkit"
import { useCallback, useRef } from "react"

export type UseDocLeaveGuardInput = {
	/** Whether there are unsaved changes that should block navigation. */
	readonly dirty: boolean
	/** Message shown in the system confirm dialog. */
	readonly message: string
}

/**
 * Structural subset of the blocker location args — compatible with
 * TanStack Router's `ShouldBlockFn` via parameter contravariance.
 */
type BlockLocation = {
	readonly pathname: string
	readonly search: unknown
}

/**
 * Blocks navigation when the document has unsaved changes, using the browser's
 * native `confirm` dialog for both in-app navigation and tab close.
 *
 * Navigations that stay on the same location are always allowed: they cannot
 * lose unsaved changes. This exemption covers the synthetic history entries
 * pushed by `useMobileBackToClose` on mobile — closing an overlay (e.g. the
 * tag-chip color popover) calls `history.back()` to a same-URL entry, which
 * the blocker would otherwise mistake for leaving the page and spam confirms.
 */
export function useDocLeaveGuard(input: UseDocLeaveGuardInput): void {
	const { dirty, message } = input

	const dirtyRef = useRef(dirty)
	dirtyRef.current = dirty
	const messageRef = useRef(message)
	messageRef.current = message

	const shouldBlockFn = useCallback(
		({
			current,
			next,
		}: {
			current: BlockLocation
			next: BlockLocation
		}): boolean => {
			if (!dirtyRef.current) return false
			if (
				current.pathname === next.pathname &&
				isEqual(current.search, next.search)
			) {
				return false
			}
			return !window.confirm(messageRef.current)
		},
		[],
	)

	const enableBeforeUnload = useCallback((): boolean => dirtyRef.current, [])

	useBlocker({
		shouldBlockFn,
		enableBeforeUnload,
	})
}
