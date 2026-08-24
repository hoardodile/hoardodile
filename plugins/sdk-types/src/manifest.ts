import { z } from "zod"

/**
 * Plugin manifest UUID (v4). Generated once when scaffolding a plugin
 * (e.g. `crypto.randomUUID()`) and never reused across plugins — the
 * server keys installed plugins by this id.
 */
export const pluginManifestId = z.string().uuid()
export type PluginManifestId = z.infer<typeof pluginManifestId>

/**
 * Declared plugin capabilities. Each flag gates the corresponding API
 * surface: a plugin without `danmaku` gets no danmaku methods and the
 * host enforces the permission at the capability guard, so a manifest
 * that does not declare a capability cannot call it.
 */
export const pluginPermissions = z.object({
	/** Read/write the resource's source metadata. */
	sourceMeta: z.boolean().default(false),
	/** Produce and store search metadata facets. */
	searchMeta: z.boolean().default(false),
	/** Create/list danmaku for resources this plugin renders. */
	danmaku: z.boolean().default(false),
	/** Create/list messages for resources this plugin renders. */
	message: z.boolean().default(false),
	/** Produce content hashes for duplicate detection / image similarity. */
	imageHashes: z.boolean().default(false),
	/**
	 * List and extract archive (zip/tar/7z/…) entries. The only API
	 * surface with a write side effect (the host's extraction cache), so
	 * it is denied by default.
	 */
	container: z.boolean().default(false),
	/**
	 * The plugin asset vault: user-consented downloads into the plugin's
	 * own `vault/` directory plus the vault read/delete methods. Denied
	 * by default — every download needs this capability AND the user's
	 * per-request approval.
	 */
	download: z.boolean().default(false),
})
export type PluginPermissions = z.infer<typeof pluginPermissions>

/**
 * Label key → locale table: `{ "cover.open": { "en": "Open", "zh-CN": "打开" } }`.
 * The host's template engine resolves `t('cover.open')` against the
 * resource's locale from this map.
 */
export const localeString = z.record(z.string(), z.string())

/** Icon reference: an asset path inside the plugin zip (`assets/icon.svg`). */
export const iconRef = z.string().min(1)

/**
 * Corner template slot: a string rendered by the host's template engine
 * over the resource scope. The engine supports `{{data.field}}` paths,
 * pipes (`bytes`, `duration`, `number`, `inc`), comparisons
 * (`eq`/`ne`/`gt`/`lt`/`gte`/`lte`), `if(cond, a, b)`, `join`,
 * `t('key')` for i18n, `icon('Icon')`, `asset('path')`,
 * `kind(...)`, and `searchKindIcons()` (the plugin's search kinds).
 * Unknown expressions render as the empty string.
 */
const templateValue = z.string()

/**
 * Corner template slots for one content kind. Templates are rendered by
 * the host's template engine over the resource's file list; supported
 * directives include `{{data.field}}`, `{{duration(ms)}}`, `{{inc(n)}}`
 * and `{{t('key')}}`.
 */
const coverKindUi = z.object({
	tl: z.array(templateValue).optional(),
	tr: z.array(templateValue).optional(),
	bl: z.array(templateValue).optional(),
	br: z.array(templateValue).optional(),
})

/**
 * Cover templates per content kind. A plugin declares the kinds it can
 * produce; the host picks the block matching the resource's cover type
 * (`image`/`video`/`audio`/`default`) and renders each corner as
 * specified, or falls back to the default cover when no block matches.
 */
const coverKindUiMap = z.object({
	image: coverKindUi.optional(),
	video: coverKindUi.optional(),
	audio: coverKindUi.optional(),
	default: coverKindUi.optional(),
})

/**
 * A search facet kind: a named dimension with an icon, rendered as a
 * facet group in the host's search UI. `key` becomes the facet key in
 * the search metadata the plugin produces.
 */
export const searchKind = z.object({
	key: z.string().min(1),
	/** i18n label key shown as the facet group's title. */
	label: z.string().min(1),
	/** Optional icon asset path in the plugin zip. */
	icon: templateValue.optional(),
})
export type SearchKind = z.infer<typeof searchKind>

const searchUi = z.object({
	kinds: z.array(searchKind),
})

const messageUi = z.object({
	/**
	 * Template string for message anchor chip labels. Rendered by the
	 * host's template engine. Supports `{{data.field}}`, `{{duration(ms)}}`,
	 * `{{inc(n)}}`, `{{t('key')}}`, etc.
	 */
	anchor: z.string().min(1).optional(),
})

/**
 * Manifest-declared UI preferences. These shape how the host app
 * presents the plugin's iframe without the plugin shipping any host
 * integration code.
 */
export const pluginManifestUi = z.object({
	/**
	 * Preferred preview surface height (any CSS length, e.g. "85vh").
	 * Applied by both the resource detail page and the preview dialog.
	 */
	height: z.string().min(1).optional(),
	/**
	 * Preferred preview surface aspect ratio (e.g. "16/9"), capped by the
	 * host at 70vh. Intended for video-centric plugins; takes precedence
	 * over `height`. When neither is set the host falls back to 60vh.
	 */
	aspect: z.string().min(1).optional(),
	/**
	 * Cover template blocks per content kind. When present, the host
	 * renders the resource cover from the plugin's file templates
	 * instead of the built-in thumbnail pipeline.
	 */
	card: coverKindUiMap.optional(),
	/** Search facet kinds; enables the plugin's search integration. */
	search: searchUi.optional(),
	/**
	 * Anchor chip label template for messages; declares message-anchor
	 * support in the host UI.
	 */
	message: messageUi.optional(),
	/**
	 * Whether the plugin iframe inherits the host's app font (default true).
	 * Set to false for plugins that must render with their own fonts.
	 */
	inheritFont: z.boolean().optional(),
})
export type PluginManifestUi = z.infer<typeof pluginManifestUi>
export type CoverKindUi = z.infer<typeof coverKindUi>
export type CoverKindUiMap = z.infer<typeof coverKindUiMap>

/**
 * The plugin manifest contract — the single schema validated everywhere
 * via its parse: the server at install time, the build CLI, and the
 * workbench. A manifest lives at the zip root of a built plugin next to
 * `main.js` and `index.html`.
 */
export const pluginManifest = z.object({
	id: pluginManifestId,
	/** Display name shown in the plugins list and resource badges. */
	name: z.string().min(1),
	/** One-line description shown in the plugins list. */
	description: z.string().min(1),
	/** Icon asset path inside the plugin zip. */
	icon: iconRef.optional(),
	/** Semantic plugin version; shown to users on the plugin card. */
	version: z.string().min(1),
	/** Declared capabilities (see {@link pluginPermissions}). */
	permissions: pluginPermissions,
	/**
	 * Localized label tables: `{ labelKey: { locale: label } }`, e.g.
	 * `{ "cover.open": { "en": "Open", "zh-CN": "打开" } }` — labels are
	 * referenced from templates with `{{t('labelKey')}}` (see
	 * {@link localeString}).
	 */
	i18n: z.record(z.string(), localeString).optional(),
	/** UI preferences (see {@link pluginManifestUi}). */
	ui: pluginManifestUi.optional(),
})
export type PluginManifest = z.infer<typeof pluginManifest>
