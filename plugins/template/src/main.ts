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
	// Optional: the host runs this once after a successful install/update
	// commit (marketplace install/update, zip uploads), with an
	// install-scoped API — no resource is attached (the file surface is
	// empty) but `download` still works behind the shared consent
	// dialog. Best-effort by contract: a throw (or a denied consent)
	// never fails the install, so re-check at runtime.
	//
	// onInstall: async (api) => {
	// 	await api.download({
	// 		url: "https://example.com/runtime.min.js",
	// 		dest: "runtime/runtime.min.js",
	// 		sha256: "…64 lowercase hex…",
	// 		reason: "…shown in the consent dialog…",
	// 	})
	// },
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
