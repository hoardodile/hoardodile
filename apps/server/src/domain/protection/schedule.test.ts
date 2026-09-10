import { describe, expect, it } from "vitest"
import { autoBackupDue, autoBackupIntervalHours } from "./schedule.ts"

const HOUR = 3_600_000
const NOW = 1_700_000_000_000
const due = (input: Partial<Parameters<typeof autoBackupDue>[0]>) =>
	autoBackupDue({
		changed: true,
		lastAutoBackupAt: null,
		lastBackupAt: null,
		intervalHours: 24,
		now: NOW,
		...input,
	})

describe("automatic backup cadence", () => {
	it("never runs without a library change, even long after the interval", () => {
		expect(
			due({
				changed: false,
				lastAutoBackupAt: NOW - 10 * 24 * HOUR,
			}),
		).toBe(false)
	})

	it("runs on the first change when no backup exists yet", () => {
		expect(due({})).toBe(true)
	})

	it("seeds the baseline with the first completed backup", () => {
		expect(due({ lastBackupAt: NOW - 30 * 60_000 })).toBe(false)
		expect(due({ lastBackupAt: NOW - 25 * HOUR })).toBe(true)
	})

	it("runs again only once the interval elapsed since the last automatic backup", () => {
		expect(due({ lastAutoBackupAt: NOW - 23 * HOUR })).toBe(false)
		expect(due({ lastAutoBackupAt: NOW - 24 * HOUR })).toBe(true)
		expect(due({ lastAutoBackupAt: NOW - 48 * HOUR })).toBe(true)
	})

	it("prefers the automatic baseline over a newer manual backup", () => {
		expect(
			due({ lastAutoBackupAt: NOW - 30 * HOUR, lastBackupAt: NOW - 60_000 }),
		).toBe(true)
	})

	it("honours a shorter configured interval", () => {
		expect(due({ intervalHours: 6, lastAutoBackupAt: NOW - 7 * HOUR })).toBe(
			true,
		)
		expect(due({ intervalHours: 6, lastAutoBackupAt: NOW - 5 * HOUR })).toBe(
			false,
		)
	})
})

describe("configured interval bounds", () => {
	it("defaults to a daily interval", () => {
		expect(autoBackupIntervalHours.parse(undefined)).toBe(24)
	})

	it("rejects anything outside 1–168 hours", () => {
		expect(autoBackupIntervalHours.safeParse(0).success).toBe(false)
		expect(autoBackupIntervalHours.safeParse(169).success).toBe(false)
		expect(autoBackupIntervalHours.safeParse(1.5).success).toBe(false)
	})

	it("accepts the shortest and longest presets", () => {
		expect(autoBackupIntervalHours.parse(1)).toBe(1)
		expect(autoBackupIntervalHours.parse(168)).toBe(168)
	})
})
