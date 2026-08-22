import type { ResourceAPI } from "@hoardodile/sdk-server"
import { definePlugin } from "@hoardodile/sdk-server"
import { extname } from "@hoardodile/sdk-server/helpers"
import type { TemplateSchema, TemplateSourceMeta } from "./shared"

/**
 * The template claims every resource that contains at least one `.hdtpl`
 * file. Replace this with your own detection logic — see the composable
 * detectors (`hasExt`, `hasName`, `minFiles`, `all`, `any`, `not`).
 */
const TEMPLATE_EXTS = new Set([".hdtpl"])

export default definePlugin<TemplateSchema>({
	detect: async (api) => {
		const files = await api.listFileNames()
		const hdtpl = files.filter((name) => TEMPLATE_EXTS.has(extname(name)))
		return hdtpl.length === 0
			? { ok: false, reasons: ["no .hdtpl file"] }
			: // The classification rides on the match: the host keeps it
				// and exposes it to the other hooks as `api.context.detect`,
				// so sourceMeta never rescans.
				{ ok: true, hdtplCount: hdtpl.length }
	},
	sourceMeta: buildSourceMeta,
})

async function buildSourceMeta(
	api: ResourceAPI<TemplateSchema>,
): Promise<TemplateSourceMeta> {
	const files = (await api.listFileNames()).filter((name) =>
		TEMPLATE_EXTS.has(extname(name)),
	)
	// `api.context.detect` is typed via the schema's `detect` slot, but
	// may be undefined on a fresh worker — fall back to re-deriving.
	const hdtplCount = api.context.detect?.hdtplCount ?? files.length
	return { files, hdtplCount }
}
