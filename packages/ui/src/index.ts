/**
 * @hoardodile/ui — the design-system component library for hoardodile
 * (the host app and plugin iframes alike). Components are importable
 * per-path (`@hoardodile/ui/components/button`,
 * `@hoardodile/ui/components/app-dialog`, `@hoardodile/ui/icons/registry`,
 * ...) so bundles stay small; hooks live under
 * `@hoardodile/ui/hooks/*` and shared CSS variables in
 * `@hoardodile/ui/theme.css`. The root entry re-exports only app-owned
 * pieces that don't fit the subpath layout.
 *
 * Theme classes: `@hoardodile/ui/theme.css` defines the `.light` /
 * `.dark` variables and per-palette `.theme-<id>` blocks the host app
 * and plugin iframes both consume.
 */

export type { AppDialogProps } from "./components/app-dialog.tsx"
export { AppDialog } from "./components/app-dialog.tsx"
export {
	setNavigationResolver,
	useMobileBackToClose,
} from "./hooks/useMobileBackToClose.ts"
export { cn } from "./lib/utils.ts"
