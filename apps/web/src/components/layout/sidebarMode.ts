import { createContext, useContext } from "react"

/**
 * Controls for a claimed sidebar slot's two modes — the route module
 * (e.g. the documents tree) and the main menu covering it. Provided by
 * the AppShell; portaled module content stays a React descendant through
 * createPortal, so it can read this context to switch modes itself.
 */
export type SidebarModeValue = {
	readonly moduleVisible: boolean
	readonly showMainMenu: () => void
	readonly showModule: () => void
}

const SidebarModeContext = createContext<SidebarModeValue | undefined>(
	undefined,
)

export const SidebarModeProvider = SidebarModeContext.Provider

/** Reads the shell's sidebar mode controls; undefined outside the shell. */
export function useSidebarMode(): SidebarModeValue | undefined {
	return useContext(SidebarModeContext)
}
