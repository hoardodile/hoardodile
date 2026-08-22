/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { getTimeZoneOptions } from "./timezones"

function offsetMinutesFromLabel(label: string): number {
	const match = /^GMT(?:([+-])(\d{2}):(\d{2}))? /.exec(label)
	if (!match) throw new Error(`unexpected label format: ${label}`)
	if (!match[1]) return 0
	const minutes = Number(match[2]) * 60 + Number(match[3])
	return match[1] === "-" ? -minutes : minutes
}

describe("getTimeZoneOptions", () => {
	test("covers every zone from Intl.supportedValuesOf", () => {
		const options = getTimeZoneOptions()
		const values = new Set(options.map((option) => option.value))
		for (const timeZone of Intl.supportedValuesOf("timeZone")) {
			expect(values.has(timeZone)).toBe(true)
		}
		expect(options).toHaveLength(Intl.supportedValuesOf("timeZone").length)
	})

	test("labels carry the GMT offset and zone name", () => {
		const options = getTimeZoneOptions()
		const shanghai = options.find((option) => option.value === "Asia/Shanghai")
		expect(shanghai?.label).toBe("GMT+08:00 Asia/Shanghai")
		// Zero-offset zones may render as `GMT` or `GMT+00:00` depending on ICU.
		const abidjan = options.find((option) => option.value === "Africa/Abidjan")
		expect(abidjan?.label).toMatch(/^GMT(\+00:00)? Africa\/Abidjan$/)
	})

	test("sorted by offset, then by zone name", () => {
		const options = getTimeZoneOptions()
		for (let i = 1; i < options.length; i++) {
			const prev = options[i - 1]
			const next = options[i]
			if (prev === undefined || next === undefined) continue
			const prevOffset = offsetMinutesFromLabel(prev.label)
			const nextOffset = offsetMinutesFromLabel(next.label)
			expect(nextOffset).toBeGreaterThanOrEqual(prevOffset)
			if (nextOffset === prevOffset) {
				expect(next.value.localeCompare(prev.value)).toBeGreaterThan(0)
			}
		}
	})

	test("returns the cached array on repeat calls", () => {
		expect(getTimeZoneOptions()).toBe(getTimeZoneOptions())
	})
})
