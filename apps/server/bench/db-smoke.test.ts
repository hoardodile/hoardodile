import { describe, expect, test, vi } from "vitest"
import { runSuiteModule } from "./args.ts"
import { dbSuite } from "./suites/db.ts"

describe("db suite end-to-end", () => {
	test("a tiny run produces a valid report whose metrics feed the gate", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			const { common, report, extractMetrics } = await runSuiteModule(dbSuite, [
				"db",
				"--rows=100",
				"--time=100",
			])
			expect(common.seed).toBe(42)
			expect(report.schema).toBe(1)
			expect(report.kind).toBe("db")
			expect(report.config).toMatchObject({ rows: 100, time: 100 })
			expect(report.machine.cpus).toBeGreaterThan(0)
			expect(report.machine.node).toBe(process.version)

			const metrics: readonly { name: string; unit: string; median: number }[] =
				extractMetrics(report)
			const names = metrics.map((m) => m.name)
			for (const expected of [
				"findById",
				"findCardById",
				"listPage",
				"listPage.countOnly",
				"listPage.nameQuery",
				"listCardPage",
				"rowToResource.200rows",
				"rawSql.preppedGet",
			]) {
				expect(names).toContain(expected)
			}
			expect(new Set(names).size).toBe(names.length)
			expect(metrics.every((m) => m.unit === "ms")).toBe(true)
			expect(metrics.every((m) => m.median > 0)).toBe(true)
		} finally {
			spy.mockRestore()
		}
	}, 60_000)
})
