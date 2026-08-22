import type { PluginSchema } from "@hoardodile/sdk-types"

export type TemplateFile = {
	readonly filename: string
}

export type TemplateSourceMeta = {
	readonly files: readonly string[]
	/** Number of `.hdtpl` files — classified once by `detect`, reused by
	 *  `sourceMeta` via `api.context.detect`. */
	readonly hdtplCount: number
}

/**
 * Declared once and shared between the server definition (`definePlugin`)
 * and the web API (`definePluginAPI`) so both sides stay in sync.
 */
export interface TemplateSchema extends PluginSchema {
	readonly file: TemplateFile
	readonly sourceMeta: TemplateSourceMeta
	/**
	 * The classification `detect` spreads onto its match. Declaring the
	 * slot types `api.context.detect` for the other hooks.
	 */
	readonly detect: { readonly hdtplCount: number }
}
