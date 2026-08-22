// @vitest-environment node
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { mergeTheme } from "./merge-config"
import { cn } from "./utils"

// merge-config.ts registers the app's custom @theme tokens (theme.css) with
// tailwind-merge, so custom utilities get correct conflict semantics — e.g.
// `text-ui` must behave as a font size, not as a text color. Two pins:
// 1. Token contract: every @theme token in a covered namespace is
//    registered. Add a token, go red until registered — no silent drift.
// 2. Behavior: the merges that previously misbehaved, pinned.
// Vitest runs with the package root as cwd (see scan-contract.test.ts).
const THEME_CSS = join(process.cwd(), "src", "styles", "theme.css")

// Namespaces whose tokens the merge config owns; keys mirror the v4
// `--<namespace>-*` prefixes one-to-one.
const NAMESPACES = [
	"text",
	"spacing",
	"tracking",
	"shadow",
	"container",
	"font",
	"ease",
	"animate",
] as const

// Names already covered by tailwind-merge's default config under the same
// token name — registered there, not here.
const BUILTIN: Partial<Record<(typeof NAMESPACES)[number], readonly string[]>> =
	{
		font: ["sans"],
		ease: ["in", "out"],
	}

function themeTokens(namespace: string): string[] {
	const css = readFileSync(THEME_CSS, "utf8")
	const open = css.indexOf("{", css.indexOf("@theme"))
	let depth = 0
	let end = css.length
	for (let i = open; i < css.length; i++) {
		if (css[i] === "{") depth++
		else if (css[i] === "}") {
			depth--
			if (depth === 0) {
				end = i
				break
			}
		}
	}
	const tokens = new Set<string>()
	for (const match of css.slice(open, end).matchAll(/--([\w-]+)\s*:/g)) {
		// `--text-ui--line-height` is the line-height companion of `text-ui`,
		// not a separate utility — resolve it to its base token.
		const name = match[1]!.replace(/--line-height$/, "")
		if (name.startsWith(`${namespace}-`)) {
			tokens.add(name.slice(namespace.length + 1))
		}
	}
	return [...tokens]
}

describe("tailwind-merge theme config", () => {
	it("registers every custom @theme token", () => {
		for (const namespace of NAMESPACES) {
			const covered = mergeTheme[namespace] as readonly string[]
			const builtin = BUILTIN[namespace] ?? []
			const unregistered = themeTokens(namespace).filter(
				(token) => !covered.includes(token) && !builtin.includes(token),
			)
			expect(
				unregistered,
				`--${namespace}-* tokens missing from mergeTheme.${namespace}`,
			).toEqual([])
		}
	})

	it("merges custom font sizes as sizes, not colors", () => {
		expect(cn("text-ui text-foreground")).toBe("text-ui text-foreground")
		expect(cn("text-tiny text-muted-foreground")).toBe(
			"text-tiny text-muted-foreground",
		)
		expect(cn("text-doc-title text-primary")).toBe(
			"text-doc-title text-primary",
		)
	})

	it("keeps custom font sizes mutually exclusive with the builtin scale", () => {
		expect(cn("text-ui text-sm")).toBe("text-sm")
		expect(cn("text-sm text-ui")).toBe("text-ui")
	})

	it("merges the other custom token families with correct conflicts", () => {
		expect(cn("h-control h-10")).toBe("h-10")
		expect(cn("max-w-content max-w-md")).toBe("max-w-md")
		expect(cn("tracking-label tracking-wide")).toBe("tracking-wide")
		expect(cn("shadow-card shadow-sm")).toBe("shadow-sm")
		expect(cn("font-doc font-sans")).toBe("font-sans")
		expect(cn("ease-standard ease-out")).toBe("ease-out")
		expect(cn("animate-skel animate-pop")).toBe("animate-pop")
	})

	it("keeps custom tokens from different groups side by side", () => {
		expect(cn("text-ui leading-[1.75]")).toBe("text-ui leading-[1.75]")
		expect(cn("h-nav min-h-nav")).toBe("h-nav min-h-nav")
		expect(cn("font-doc text-doc-title")).toBe("font-doc text-doc-title")
	})
})
