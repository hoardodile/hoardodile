import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Default grace period after a dialog is told to close before its payload
 * and typed input are actually wiped. Matches the Radix/Tailwind exit
 * animation so the content doesn't disappear while the dialog is still
 * animating out.
 */
const DIALOG_CLOSE_DELAY_MS = 150

/**
 * State helper for typed-confirmation dialogs (e.g. {@link ConfirmByTypingDialog}).
 *
 * Bundles the two pieces of state every callsite repeats — the open
 * `target` payload and the user-typed string — and the standard
 * `open`/`close`/`reset`/`onOpenChange` callbacks. The shape of `target`
 * is parameterised so callers can carry whatever payload they need
 * (e.g. `{ kind: "delete"; name: string }`).
 *
 * The hook deliberately keeps `target`/`typed` alive for a short delay
 * after `close()` so the dialog content survives the CSS exit animation.
 *
 * @example
 *   const dialog = useConfirmDialog<{ kind: "delete"; name: string }>()
 *   // open:
 *   dialog.open({ kind: "delete", name: backup.name })
 *   // bind:
 *   <ConfirmByTypingDialog
 *     open={dialog.isOpen}
 *     onOpenChange={dialog.onOpenChange}
 *     typed={dialog.typed}
 *     onTypedChange={dialog.setTyped}
 *     ... />
 */
export type ConfirmDialog<TTarget> = {
	readonly target: TTarget | undefined
	readonly typed: string
	readonly isOpen: boolean
	readonly setTyped: (value: string) => void
	readonly open: (target: TTarget) => void
	readonly close: () => void
	readonly onOpenChange: (open: boolean) => void
}

export function useConfirmDialog<TTarget>(): ConfirmDialog<TTarget> {
	const [isOpen, setIsOpen] = useState(false)
	const [target, setTarget] = useState<TTarget | undefined>(undefined)
	const [typed, setTyped] = useState("")
	const clearTimeoutRef = useRef<number | null>(null)

	const cancelPendingClear = useCallback(() => {
		if (clearTimeoutRef.current !== null) {
			window.clearTimeout(clearTimeoutRef.current)
			clearTimeoutRef.current = null
		}
	}, [])

	// Clean up any in-flight timeout if the owning component unmounts.
	useEffect(() => cancelPendingClear, [cancelPendingClear])

	const clear = useCallback(() => {
		setTarget(undefined)
		setTyped("")
	}, [])

	const close = useCallback(() => {
		cancelPendingClear()
		setIsOpen(false)
		clearTimeoutRef.current = window.setTimeout(() => {
			clear()
		}, DIALOG_CLOSE_DELAY_MS)
	}, [cancelPendingClear, clear])

	const open = useCallback(
		(next: TTarget) => {
			cancelPendingClear()
			setIsOpen(true)
			setTarget(next)
			setTyped("")
		},
		[cancelPendingClear],
	)

	const onOpenChange = useCallback(
		(next: boolean) => {
			if (!next) close()
		},
		[close],
	)

	return {
		target,
		typed,
		isOpen,
		setTyped,
		open,
		close,
		onOpenChange,
	}
}
