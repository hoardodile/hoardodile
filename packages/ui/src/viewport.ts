/**
 * Mobile viewport initial-scale factor used across the app shell and
 * plugin iframe previews. Kept in one place so it can be changed
 * without hunting through HTML templates and CSS rules.
 */
export const MOBILE_INITIAL_SCALE = 0.8

/**
 * Width in pixels at which the app switches from below-md to md+ layouts.
 *
 * This value is intentionally aligned with Tailwind's `md` breakpoint
 * (768 px) so that JS detection and CSS responsive prefixes stay in sync.
 * Components that need to know whether they are in the "below md" viewport
 * should use {@link isBelowMd} or {@link useBelowMd} from @hoardodile/ui/hooks/use-mobile.
 */
export const MOBILE_BREAKPOINT_PX = 768

/**
 * Same breakpoint expressed in rems, matching Tailwind's default theme
 * (`--breakpoint-md: 48rem`). Useful for CSS media queries and comments.
 */
export const MOBILE_BREAKPOINT_REM = MOBILE_BREAKPOINT_PX / 16

/**
 * Media query string that matches viewports below the `md` breakpoint
 * (< 768 px). Shared between JS hooks and anywhere else that needs to detect
 * a below-md viewport.
 *
 * Keep this in sync with the CSS/Tailwind breakpoint so JS and CSS never
 * disagree about the viewport size.
 */
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`

/**
 * Width in pixels at which the app switches from a drawer to a fixed left
 * sidebar (the "app shell"). Raised above `md` so mid-size viewports keep
 * the whole width for their content column — below this the sidebar hides
 * behind the hamburger drawer.
 *
 * Use the CSS `sidebar:` / `max-sidebar:` variants (`--breakpoint-sidebar`)
 * at call sites — this value is the single source of truth for both.
 */
export const SIDEBAR_BREAKPOINT_PX = 1150

/**
 * Media query string that matches viewports below the sidebar breakpoint
 * (`max-sidebar`), i.e. where the shell shows the drawer instead of the fixed
 * sidebar. Shared between JS hooks and anywhere else that needs the
 * below-sidebar viewport.
 */
export const SIDEBAR_QUERY = `(max-width: ${SIDEBAR_BREAKPOINT_PX - 1}px)`

/**
 * Width in pixels at which the right filter rail switches from a fixed
 * column to a drawer (DESIGN.md — Layout: "the panel becomes an
 * overlay below 1440px"). Below this the sidebar + panel + content no
 * longer fit comfortably, so the rail hides behind a Filters button.
 *
 * Use the CSS `panel:` / `max-panel:` variants (`--breakpoint-panel`)
 * at call sites — this value is the single source of truth for both.
 */
export const PANEL_BREAKPOINT_PX = 1440

/**
 * Media query string that matches viewports below the panel breakpoint
 * (< 1440 px), i.e. where the filter rail lives in a drawer. Shared
 * between JS hooks and anywhere else that needs the below-panel viewport.
 */
export const PANEL_QUERY = `(max-width: ${PANEL_BREAKPOINT_PX - 1}px)`
