import { readFileSync } from "node:fs"
import { join } from "node:path"
import { compile } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"

// Consumers import `@hoardodile/ui/theme.css`, which resolves to the dist
// copy. Its `@source` glob is relative to that file, so it only sees what
// tsup ships — this test compiles the built stylesheet exactly like a
// consumer's Tailwind would, pinning the published artifact against the
// components it must style. It goes red if the glob stops matching the
// tsup outputs (wrong extension, moved dist layout, minified output, ...).
// Vitest runs with the package root as cwd; `import.meta.url` is not a
// file URL under its module runner, so resolve from cwd instead.
const DIST_STYLES = join(process.cwd(), "dist", "styles")

const REPRESENTATIVE_CANDIDATES = [
	// dialog surface + exit animation
	"bg-popover",
	"text-popover-foreground",
	"sm:data-starting-style:scale-95",
	// button variants, icon slots, dark input
	"hover:bg-primary/80",
	"has-data-[icon=inline-end]:pr-2",
	"dark:bg-input/30",
	// button-group slot override
	"in-data-[slot=button-group]:rounded-md",
	// popover anchor animation
	"data-[side=bottom]:slide-in-from-top-2",
] as const

describe("theme.css scan contract", () => {
	it("scans the tsup outputs and generates the component utilities", async () => {
		const themeCss = readFileSync(join(DIST_STYLES, "theme.css"), "utf8")
		// `tw-animate-css` / `shadcn/tailwind.css` are package-name imports
		// resolved by the consumer's Tailwind toolchain; compile() resolves
		// only relative imports, so strip them. They don't affect the scan
		// contract under test.
		const entry = themeCss.replace(
			/@import "tw-animate-css";\n@import "shadcn\/tailwind.css";\n/g,
			"",
		)

		const compiled = await compile(entry, {
			base: DIST_STYLES,
			onDependency: () => {},
		})
		expect(compiled.sources.length).toBeGreaterThan(0)

		const candidates = new Set(
			new Scanner({ sources: compiled.sources }).scan(),
		)
		for (const candidate of REPRESENTATIVE_CANDIDATES) {
			expect([...candidates]).toContain(candidate)
		}

		const css = compiled.build([...candidates])
		// theme.css itself went through (palettes survive the entry surgery)
		expect(css).toContain(".theme-parchment")
		// build() pretty-prints (`{` on its own line), so assert on the
		// selector text and one rule body rather than brace positions
		for (const fragment of [
			".bg-popover",
			"background-color: var(--popover);",
			".text-popover-foreground",
			"data-starting-style\\:scale-95",
			"has-data-\\[icon",
			"in-data-\\[slot\\=button-group\\]",
			"hover\\:bg-primary\\/80",
			".dark\\:bg-input\\/30",
		]) {
			expect(css).toContain(fragment)
		}
	})
})
