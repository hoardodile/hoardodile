import { describe, expect, it } from "vitest"
import de from "../locales/de"
import en from "../locales/en"
import es from "../locales/es"
import ja from "../locales/ja"
import zh from "../locales/zh"

const BUNDLES: Record<string, Record<string, unknown>> = {
	en: en as unknown as Record<string, unknown>,
	zh: zh as unknown as Record<string, unknown>,
	ja: ja as unknown as Record<string, unknown>,
	de: de as unknown as Record<string, unknown>,
	es: es as unknown as Record<string, unknown>,
}

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

function vars(value: string): string {
	return (value.match(/\{\{[^}]+\}\}/g) ?? [])
		.map((m) => m.slice(2, -2))
		.sort()
		.join(",")
}

describe("plugin locale parity", () => {
	const enFlat = flatten(BUNDLES.en!)
	const enKeys = new Set(enFlat.map((r) => r.key))

	it("ships every hoardodile-supported language", () => {
		expect(Object.keys(BUNDLES).sort()).toEqual(["de", "en", "es", "ja", "zh"])
	})

	it("has identical flat key sets across all bundles", () => {
		for (const [lang, bundle] of Object.entries(BUNDLES)) {
			const flat = flatten(bundle)
			const keys = new Set(flat.map((r) => r.key))
			expect(
				[...enKeys].filter((k) => !keys.has(k)),
				`keys only in en`,
			).toEqual([])
			expect(
				[...keys].filter((k) => !enKeys.has(k)),
				`keys only in ${lang}`,
			).toEqual([])
		}
	})

	it("uses the same interpolation placeholders per key", () => {
		for (const [lang, bundle] of Object.entries(BUNDLES)) {
			const byKey = new Map(flatten(bundle).map((r) => [r.key, r.value]))
			const mismatched: string[] = []
			for (const { key, value } of enFlat) {
				const other = byKey.get(key)
				if (other !== undefined && vars(value) !== vars(other)) {
					mismatched.push(key)
				}
			}
			expect(mismatched, `placeholder mismatch in ${lang}`).toEqual([])
		}
	})

	it("never ships untranslated English source copy", () => {
		const english = new Map(enFlat.map((r) => [r.key, r.value]))
		for (const [lang, bundle] of Object.entries(BUNDLES)) {
			if (lang === "en") continue
			const untranslated: string[] = []
			for (const { key, value } of flatten(bundle)) {
				if (value === english.get(key)) untranslated.push(key)
			}
			expect(untranslated, `untranslated keys in ${lang}`).toEqual([])
		}
	})
})
