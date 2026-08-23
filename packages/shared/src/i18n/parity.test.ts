/**
 * @vitest-environment node
 *
 * Guardrails that keep the two i18n catalogs in lockstep. These caught two
 * real regressions historically (dead `_plural` keys under i18next v4 and a
 * missing zh mirror), so they are intentionally strict: a new key must be
 * registered in both languages before it can ship.
 *
 * Structural rules only (key parity, placeholders, plural pairs, ellipsis).
 * Key *naming* is intentionally not enforced — see the documented
 * conventions in `packages/shared/src/i18n/index.ts`.
 */
import { describe, expect, it } from "vitest"
import en from "./en.json"
import zh from "./zh.json"

function flatten(
	obj: Record<string, unknown>,
	path: string[] = [],
	out: { key: string; value: string }[] = [],
): { key: string; value: string }[] {
	for (const [k, v] of Object.entries(obj)) {
		if (typeof v === "object" && v !== null) {
			flatten(v as Record<string, unknown>, [...path, k], out)
		} else {
			out.push({ key: [...path, k].join("."), value: String(v) })
		}
	}
	return out
}

const enFlat = flatten(en as unknown as Record<string, unknown>)
const zhFlat = flatten(zh as unknown as Record<string, unknown>)

function vars(value: string): string {
	return (value.match(/\{\{[^}]+\}\}/g) ?? [])
		.map((m) => m.slice(2, -2))
		.sort()
		.join(",")
}

/** Keys that legitimately keep `{{count}}` without a plural pair. */
const NO_PLURAL_PAIR_ALLOWLIST = new Set([
	"search.sectionCount", // "({{count}})" parenthetical
	"search.viewAll", // "View all ({{count}})"
	"me.custom.unusedCount", // "{{count}} unused" (adjective)
	"me.desktop.lan.moreAddresses", // "Other addresses ({{count}})" parenthetical
	"me.trash.view", // "Review trash ({{count}})"
	"plugins.countInstalled", // "{{count}} installed" (adjective)
	"usage.leaderboard.associatedSessionsShort", // "{{count}} associated" (adjective)
	"categories.panel.dependencyResources", // "{{count}} res" (abbreviation)
	"categories.panel.dependencyCharacters", // "{{count}} char" (abbreviation)
	"categories.panel.tagCharacterCount", // "char {{count}}"
	"categories.panel.tagResourceCount", // "res {{count}}"
	"deleteEntity.usageMessage", // usage noun is passed in (singular when count=1)
	"documents.statusBar.charCount", // "{{count}} / {{max}} chars" (range)
	"sync.banner.overdueDescription", // "{{count}}-day reminder" (compound)
	"trace.overview.moreThanPrev", // "{{count}} more than the previous period"
	"trace.overview.lessThanPrev", // "{{count}} less than the previous period"
	"characters.bulk.toolbarCount", // "{{count}} selected" (adjective)
	"resources.bulk.toolbarCount", // "{{count}} selected" (adjective)
	"characters.bulk.toastAllFailed", // "({{count}} failed)" parenthetical
	"resources.bulk.toastAllFailed", // "({{count}} failed)" parenthetical
	"characters.selectorDialog.confirmCount", // "Confirm ({{count}})"
	"messages.viewReplies", // "View replies ({{count}})"
])

/** Keys that keep ASCII `...` in the value (URL placeholders). */
const ASCII_ELLIPSIS_ALLOWLIST = new Set([
	"resources.new.sourceUrlPlaceholder",
	"resources.editDialog.sourceUrlPlaceholder",
])

describe("i18n catalog parity", () => {
	const enKeys = new Set(enFlat.map((r) => r.key))
	const zhKeys = new Set(zhFlat.map((r) => r.key))

	it("has identical flat key sets", () => {
		expect(
			[...enKeys].filter((k) => !zhKeys.has(k)),
			"keys only in en.json",
		).toEqual([])
		expect(
			[...zhKeys].filter((k) => !enKeys.has(k)),
			"keys only in zh.json",
		).toEqual([])
	})

	it("uses the same interpolation placeholders per key", () => {
		const zhByKey = new Map(zhFlat.map((r) => [r.key, r.value]))
		const mismatched: string[] = []
		for (const { key, value } of enFlat) {
			const zv = zhByKey.get(key)
			if (zv !== undefined && vars(value) !== vars(zv)) {
				mismatched.push(key)
			}
		}
		expect(mismatched, "placeholder mismatch").toEqual([])
	})

	it("has complete plural pairs and no legacy suffixes", () => {
		const bad: string[] = []
		for (const key of enKeys) {
			if (/_(plural|singular)$/.test(key)) bad.push(`${key} (legacy suffix)`)
		}
		for (const key of enKeys) {
			const base = key.replace(/_(one|other|few|many|zero)$/, "")
			if (base === key) continue
			if (!enKeys.has(`${base}_one`) || !enKeys.has(`${base}_other`)) {
				bad.push(`${key} (incomplete pair)`)
			}
		}
		expect(bad, "plural violations").toEqual([])
	})

	it("never leaves a count key without a plural pair unless allowlisted", () => {
		const enByKey = new Map(enFlat.map((r) => [r.key, r.value]))
		const violating: string[] = []
		for (const [key, value] of enByKey) {
			if (!value.includes("{{count}}")) continue
			if (/_(one|other|few|many|zero)$/.test(key)) continue
			if (NO_PLURAL_PAIR_ALLOWLIST.has(key)) continue
			violating.push(key)
		}
		expect(violating, "count key without plural pair").toEqual([])
	})

	it("uses U+2026 ellipsis everywhere except URL placeholders", () => {
		const violating = enFlat
			.filter((r) => r.value.includes("..."))
			.map((r) => r.key)
			.filter((k) => !ASCII_ELLIPSIS_ALLOWLIST.has(k))
		expect(violating, "ASCII ellipsis outside allowlist").toEqual([])
	})
})
