// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LooseTranslate } from "@/i18n"
import { dayLabel } from "./TimelineDayCards"

const t = ((key: string) => key) as LooseTranslate

describe("dayLabel", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it("labels today and yesterday", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		expect(dayLabel("2026-06-12", "UTC", t, "today", "yesterday")).toBe("today")
		expect(dayLabel("2026-06-11", "UTC", t, "today", "yesterday")).toBe(
			"yesterday",
		)
	})

	it("hides the year for dates in the current calendar year", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		expect(dayLabel("2026-08-24", "UTC", t, "today", "yesterday")).toBe("08-24")
	})

	it("keeps the year for dates in another year", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		expect(dayLabel("2024-08-24", "UTC", t, "today", "yesterday")).toBe(
			"2024-08-24",
		)
	})

	it("passes empty or odd-shaped day keys through unchanged", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 5, 12, 12, 0, 0) })
		expect(dayLabel("", "UTC", t, "today", "yesterday")).toBe("")
		expect(dayLabel("2026-6-2", "UTC", t, "today", "yesterday")).toBe(
			"2026-6-2",
		)
	})
})
