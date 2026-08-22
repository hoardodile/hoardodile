import type { ReactNode } from "react"

/**
 * Tiny group label inside picker blocks ("Selected", "Available", "Tags")
 * — the PickerGroupLabel voice: 11px, uppercase, tracked.
 */
export function GroupLabel({ children }: { readonly children: ReactNode }) {
	return (
		<span className="text-tiny font-semibold tracking-label uppercase text-muted-foreground">
			{children}
		</span>
	)
}
