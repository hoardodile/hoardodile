#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
/**
 * Generate the host's lazy Solar glyph index for manifest/template icons:
 *
 * - `apps/web/src/features/plugin/icons/solar-names.generated.ts` — the
 *   glyph name set (small; statically imported so unknown names can be
 *   rejected synchronously, keeping the plugin-tile fallback).
 * - `apps/web/src/features/plugin/icons/solar-loaders.generated.ts` — the
 *   per-glyph factories that lazily import the glyph's three parallel
 *   weights (`bold` / `bold-duotone` / `linear`) and wrap them with
 *   `createIcon` — byte-for-byte the same wrapped component shape the
 *   static registry exposes, so the three weights, the icon-style
 *   preference and `mode`/`hd-icon` semantics are inherited by
 *   construction.
 *
 * Each `import()` is its own Vite chunk: a glyph's bytes are only fetched
 * when a manifest/template icon with that name actually renders (then
 * cached for the session). The loader module is itself a lazily-imported
 * chunk, so the ~2.5k-entry factory table never rides the main bundle.
 * The generated files are NEVER committed — they regenerate before every
 * web dev/build/lint/test run (see apps/web/package.json). The source of
 * truth is the installed @solar-icons/react package's own `exports` map,
 * so the emitted specifiers can never drift from the installed version.
 */
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

function arg(name, fallback) {
	const idx = process.argv.indexOf(`--${name}`)
	if (idx === -1 || idx + 1 >= process.argv.length) return fallback
	return process.argv[idx + 1]
}

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// Target the correct consumer package. Defaults keep the web's historical
// behaviour (unchanged); the workbench passes `--pkg ./package.json
// --out ./src/icons`. The resolver is anchored on the target package's own
// package.json so the installed @solar-icons/react resolves through that
// package's dependency tree (each consumer declares it itself).
const pkgFile = resolve(
	arg("pkg", join(WORKSPACE_ROOT, "apps/web/package.json")),
)
const OUT_DIR = resolve(
	arg("out", join(WORKSPACE_ROOT, "apps/web/src/features/plugin/icons")),
)
const NAMES_FILE = join(OUT_DIR, "solar-names.generated.ts")
const LOADERS_FILE = join(OUT_DIR, "solar-loaders.generated.ts")

const requireFromPkg = createRequire(pkgFile)
const pkgPath = requireFromPkg.resolve("@solar-icons/react/package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))

const WEIGHTS = [
	{ key: "bold", exportField: "bold" },
	{ key: "boldDuotone", exportField: "bold-duotone" },
	{ key: "linear", exportField: "linear" },
]

/**
 * Resolve one weight's export map entry (`exports["./bold/*"]`) and derive
 * the on-disk module directory, so the scanner reads exactly the modules
 * the package promises to consumers.
 */
function weightDir(exportField) {
	const entry = pkg.exports?.[`./${exportField}/*`]
	const template = entry?.import ?? entry?.types
	if (typeof template !== "string") {
		throw new Error(
			`@solar-icons/react exports map has no "./${exportField}/*" entry`,
		)
	}
	const dirTemplate = template.split("*")[0]
	return join(dirname(pkgPath), dirTemplate)
}

function glyphNames(dir) {
	return [
		...new Set(
			readdirSync(dir)
				.filter((name) => name.endsWith(".mjs"))
				.map((name) => name.slice(0, -".mjs".length))
				.filter((name) => name.length > 0 && !name.startsWith(".")),
		),
	].sort()
}

async function main() {
	const dirs = new Map()
	const namesByWeight = new Map()
	for (const weight of WEIGHTS) {
		const dir = weightDir(weight.exportField)
		dirs.set(weight.key, dir)
		namesByWeight.set(weight.key, glyphNames(dir))
	}

	// Only glyphs present in ALL three weights are indexed; the renderer
	// falls back to another weight for anything missing (none today).
	const [first, ...rest] = [...namesByWeight.values()].map((s) => new Set(s))
	const common = new Set(first)
	for (const set of rest) {
		for (const name of [...common]) {
			if (!set.has(name)) common.delete(name)
		}
	}
	const names = [...common].sort()

	// The exact named export per glyph, read from the bold module (the
	// convention is `PascalCase(stem) + "Icon"`; we never guess).
	function exportName(name) {
		const source = readFileSync(join(dirs.get("bold"), `${name}.mjs`), "utf8")
		const match = source.match(/as (\w+Icon)/)
		if (match === null) {
			throw new Error(
				`@solar-icons glyph "${name}" exports no \`*Icon\` symbol`,
			)
		}
		return match[1]
	}

	const lines = []
	for (const name of names) {
		const exportSymbol = exportName(name)
		const specifiers = WEIGHTS.map(
			(weight) =>
				`import("@solar-icons/react/${weight.exportField}/${name}").then((m) => m.${exportSymbol})`,
		)
		lines.push(
			`\t"${name}": () => Promise.all([\n\t\t${specifiers.join(",\n\t\t")},\n\t]).then(([bold, boldDuotone, linear]) => createIcon({ bold, boldDuotone, linear })),`,
		)
	}

	const namesOut = `/**
 * GENERATED FILE — do not edit. Regenerate: node scripts/generate-solar-lazy-index.mjs
 *
 * The ${names.length} valid manifest/template icon names (kebab-case,
 * Solar-only). Small by design: this set is statically imported so the
 * host can reject unknown names synchronously and fall back to the
 * default tile. Built from the installed @solar-icons/react@${pkg.version}
 * exports map.
 */
export const SOLAR_GLYPH_NAMES: ReadonlySet<string> = new Set([
${names.map((name) => `\t"${name}",`).join("\n")}
])
`

	const loadersOut = `/**
 * GENERATED FILE — do not edit. Regenerate: node scripts/generate-solar-lazy-index.mjs
 *
 * ${names.length} Solar glyphs x 3 weights, lazily imported (one Vite chunk
 * per weight module; fetched only when the glyph is actually rendered).
 * Every glyph resolves to the same \`createIcon\`-wrapped component the
 * static registry exports, so the icon style preference (Settings →
 * Icons), \`mode\` and the \`hd-icon\` hook semantics are identical.
 * Built from the installed @solar-icons/react@${pkg.version} exports map.
 *
 * This module is imported dynamically (never statically) so the factory
 * table — and the glyph chunks it points at — stay out of the main bundle.
 */
import { createIcon } from "@hoardodile/ui/icons/icon-style"
import type { IconType } from "@hoardodile/ui/components/icon"

type GlyphLoader = () => Promise<IconType>

const GLYPH_LOADERS: Record<string, GlyphLoader> = {
${lines.join("\n")}
}

const loaded = new Map<string, Promise<IconType>>()

/** Load the wrapped glyph for a (normalized) Solar name; \`undefined\` for unknown names. */
export function loadSolarGlyph(name: string): Promise<IconType> | undefined {
	if (!GLYPH_LOADERS[name]) return undefined
	let promise = loaded.get(name)
	if (promise === undefined) {
		const loader = GLYPH_LOADERS[name]
		if (loader === undefined) return undefined
		promise = loader()
		loaded.set(name, promise)
	}
	return promise
}
`

	writeFileSync(NAMES_FILE, namesOut)
	writeFileSync(LOADERS_FILE, loadersOut)
	console.log(
		`[solar] glyph index generated (${names.length} glyphs x 3 weights) -> ${NAMES_FILE}, ${LOADERS_FILE}`,
	)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
