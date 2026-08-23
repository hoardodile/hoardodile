import { describe, expect, it } from "vitest"
import { en } from "../locales/en"
import { zh } from "../locales/zh"

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

describe("plugin locale parity", () => {
	const enKeys = new Set(enFlat.map((r) => r.key))
	const zhKeys = new Set(zhFlat.map((r) => r.key))

	it("has identical flat key sets", () => {
		expect(
			[...enKeys].filter((k) => !zhKeys.has(k)),
			"keys only in en",
		).toEqual([])
		expect(
			[...zhKeys].filter((k) => !enKeys.has(k)),
			"keys only in zh",
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

	it("uses U+2026 ellipsis rather than ASCII dots", () => {
		const violating = [...enFlat, ...zhFlat].filter((r) =>
			r.value.includes("..."),
		)
		expect(
			violating.map((r) => r.key),
			"ASCII ellipsis",
		).toEqual([])
	})
})
