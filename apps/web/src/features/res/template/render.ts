/**
 * Res-card template renderer, re-exported from the shared
 * `@hoardodile/ui/res-card-template` module so the app and the offline
 * workbench evaluate the same `{{...}}` grammar. Icon drawing and
 * asset-URL building are injected by each caller via {@link TemplateContext}.
 */
export {
	formatBytes,
	formatClockDuration,
	type IconRef,
	normalizeSolarGlyphName,
	type RenderIcon,
	renderCardTemplate,
	renderSlotBadges,
	resolveLocaleString,
	type TemplateContext,
} from "@hoardodile/ui/res-card-template"
