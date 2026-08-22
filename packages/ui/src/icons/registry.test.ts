// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as icons from "./registry"

/**
 * Source-structure guard for the icon registry. The file is excluded from
 * biome (packages/ui/src/icons), so this test is the only thing that
 * keeps the single export section ordered and every icon's three parallel
 * Solar weights registered — see the header comment in registry.ts for the
 * conventions.
 */
const src = readFileSync(new URL("./registry.ts", import.meta.url), "utf8")
const lines = src.split(/\r?\n/)

/** One parsed registry entry: the export name. */
function parseIcons(): string[] {
	const names: string[] = []
	for (let i = 0; i < lines.length; ) {
		const m = /^export const (\w+) = createIcon\(\{$/.exec(lines[i]!)
		if (m === null) {
			i++
			continue
		}
		const name = m[1]!
		expect(lines[i + 1]).toBe(`\tbold: ${name}BoldWeight,`)
		expect(lines[i + 2]).toBe(`\tboldDuotone: ${name}BoldDuotone,`)
		// MenuDots is the one documented exception: its thin-line dots read
		// as noise at small sizes, so the filled weight stays in every mode.
		expect(lines[i + 3]).toBe(
			name === "MenuDots"
				? "\tlinear: MenuDotsBoldWeight,"
				: `\tlinear: ${name}Linear,`,
		)
		expect(lines[i + 4]).toBe("})")
		names.push(name)
		i += 5
	}
	return names
}

const iconNames = parseIcons()

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

describe("icons registry structure", () => {
	it("keeps the export section alphabetically ordered (ordinal)", () => {
		expect([...iconNames].sort(ordinal)).toEqual(iconNames)
	})

	it("registers every icon with all three Solar weights", () => {
		for (const name of iconNames) {
			// biome-ignore lint/performance/noDynamicNamespaceImportAccess: the registry is a data module — accessing entries by parsed name is the point of the guard.
			const icon = icons[name as keyof typeof icons] as (
				props: Record<string, unknown>,
			) => unknown
			expect(typeof icon).toBe("function")
		}
	})

	it("exports exactly the names declared in the file", () => {
		expect(new Set(iconNames)).toEqual(new Set(Object.keys(icons)))
		expect(iconNames).toHaveLength(Object.keys(icons).length)
	})
})
