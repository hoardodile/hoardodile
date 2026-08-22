import {
	MOBILE_QUERY,
	PANEL_QUERY,
	SIDEBAR_QUERY,
} from "@hoardodile/ui/viewport"
import { useMedia } from "react-use"

/**
 * One-shot check for viewports below the `md` breakpoint (< 768 px).
 *
 * Prefer {@link useBelowMd} in React components so they re-render when the
 * viewport crosses the breakpoint. Use this helper only in event handlers,
 * utility functions, or effects where a reactive hook is not appropriate.
 */
export function isBelowMd(): boolean {
	if (typeof window === "undefined") return false
	return window.matchMedia(MOBILE_QUERY).matches
}

export function useBelowMd(): boolean {
	return useMedia(MOBILE_QUERY, false)
}

/**
 * Reactive check for viewports below the app-shell sidebar breakpoint
 * (`max-sidebar`), where the fixed sidebar is replaced by the hamburger
 * drawer. Keep in sync with `SIDEBAR_BREAKPOINT_PX` and the
 * `sidebar:` / `max-sidebar:` CSS variants. The shell alone decides its own chrome;
 * compact-UI consumers keep using {@link useBelowMd}.
 */
export function useBelowSidebar(): boolean {
	return useMedia(SIDEBAR_QUERY, false)
}

/**
 * Reactive check for viewports below the filter-rail breakpoint
 * (< 1440 px), where the rail becomes a drawer instead of a fixed right
 * column. Keep in sync with `PANEL_BREAKPOINT_PX` and the
 * `panel:` / `max-panel:` CSS variants.
 */
export function useBelowPanel(): boolean {
	return useMedia(PANEL_QUERY, false)
}

/**
 * Compatibility alias for official shadcn-generated components (e.g.
 * `sidebar.tsx`), which import `useIsMobile` from this module. Mobile
 * detection rules are owned by THIS file for the whole repo (apps and
 * plugins alike) — never let the registry version of `use-mobile.ts`
 * replace it; restore after every `shadcn add`.
 */
export function useIsMobile(): boolean {
	return useBelowMd()
}
