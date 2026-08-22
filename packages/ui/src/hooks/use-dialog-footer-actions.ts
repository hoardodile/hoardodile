import { createContext, type ReactNode, useContext } from "react"

/**
 * Footer action slot plumbing for `AppDialog` — the context shared
 * between the dialog shell (`@hoardodile/ui/components/app-dialog`) and
 * body panels that contribute their primary action through
 * `DialogFooterActions`, so action buttons land in the footer instead of
 * the body.
 */

type DialogFooterActionsValue = {
	readonly setFooterActions: (node: ReactNode | null) => void
}

const DialogFooterActionsContext =
	createContext<DialogFooterActionsValue | null>(null)

/** The nearest dialog's footer action slot, or null outside a dialog. */
function useDialogFooterActions(): DialogFooterActionsValue | null {
	return useContext(DialogFooterActionsContext)
}

export { DialogFooterActionsContext, useDialogFooterActions }
