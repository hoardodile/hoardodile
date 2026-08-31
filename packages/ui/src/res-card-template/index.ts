/**
 * Res-card template renderer, shared by the host app and the offline
 * workbench. Evaluates the plugin manifest's `{{...}}` template strings
 * (`ui.card.*`, `ui.search.*`, `ui.message.anchor`) over a resource's
 * hook snapshot, returning ReactNode (so icon-producing directives can
 * inject components inline). Icon drawing and asset-URL building are
 * injected by the caller, so this module never imports host-specific
 * code — see the grammar in `@hoardodile/sdk-types/template`.
 */
export { formatBytes, formatClockDuration } from "./format.ts"
export {
	type IconRef,
	normalizeSolarGlyphName,
	parseIconRef,
	type RenderIcon,
} from "./icon.ts"
export {
	renderCardTemplate,
	renderSlotBadges,
	resolveLocaleString,
	type TemplateContext,
} from "./template.ts"
