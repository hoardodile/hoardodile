import type { PluginManifest, SearchKind } from "@hoardodile/sdk-types"
import { renderCardTemplate } from "@/features/res/template/render"

function resolveLocaleString(
	value: string | Record<string, string>,
	locale: string,
): string {
	if (typeof value === "string") return value
	const exact = value[locale]
	if (exact !== undefined) return exact
	const base = locale.split("-")[0] ?? locale
	const partial = value[base]
	if (partial !== undefined) return partial
	const first = Object.values(value)[0]
	return first ?? ""
}

/**
 * Resolve a plugin's display name: prefer `i18n.name` if present,
 * otherwise fall back to the root `name` string.
 */
export function resolveManifestName(
	manifest: PluginManifest,
	locale: string,
): string {
	const override = manifest.i18n?.name
	if (override !== undefined) return resolveLocaleString(override, locale)
	return manifest.name
}

/**
 * Resolve a plugin's display description: prefer `i18n.description`
 * if present, otherwise fall back to the root `description` string.
 */
export function resolveManifestDescription(
	manifest: PluginManifest,
	locale: string,
): string {
	const override = manifest.i18n?.description
	if (override !== undefined) return resolveLocaleString(override, locale)
	return manifest.description
}

/**
 * Render a {@link SearchKind} label by running its template string through
 * {@link renderCardTemplate}. The label may contain `{{t('key')}}` calls that
 * resolve against `manifest.i18n`, and falls back to `kind.key` when the
 * rendered output is empty.
 */
export function renderSearchKindLabel(
	kind: SearchKind,
	manifest: Pick<PluginManifest, "i18n" | "ui">,
	pluginId: string,
	locale: string,
): React.ReactNode {
	const rendered = renderCardTemplate(
		kind.label,
		{ file: undefined, source: undefined, searchMeta: undefined },
		{ locale, pluginId, manifest },
	)
	if (rendered === null || rendered === undefined || rendered === "") {
		return kind.key
	}
	return rendered
}

/**
 * Render a {@link SearchKind} icon by running its template through
 * {@link renderCardTemplate}. The template typically calls `icon(...)` or
 * `asset(...)` to produce a ReactNode. Returns `undefined` when the kind has
 * no icon template or the rendered output is empty.
 */
export function renderSearchKindIcon(args: {
	readonly kind: SearchKind
	readonly manifest: Pick<PluginManifest, "i18n" | "ui">
	readonly pluginId: string
	readonly locale: string
	readonly iconClassName?: string
}): React.ReactNode {
	const { kind, manifest, pluginId, locale, iconClassName } = args
	if (kind.icon === undefined) return undefined
	const rendered = renderCardTemplate(
		kind.icon,
		{ file: undefined, source: undefined, searchMeta: undefined },
		{ locale, pluginId, manifest, iconClassName },
	)
	if (rendered === null || rendered === undefined || rendered === "") {
		return undefined
	}
	return rendered
}
