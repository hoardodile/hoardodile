import { describe, expect, test } from "vitest"
import { runStages, type Stage } from "./run-stages.ts"

type Ctx = {
	readonly events: string[]
	value: number
}

function stage(label: string, run: (ctx: Ctx) => Promise<void>): Stage<Ctx> {
	return { label, run }
}

describe("runStages", () => {
	test("sequential stages run in order over the shared context", async () => {
		const ctx: Ctx = { events: [], value: 0 }
		const report = await runStages(
			[
				stage("a", async (c) => {
					c.value += 1
					c.events.push("a")
				}),
				stage("b", async (c) => {
					c.value *= 10
					c.events.push("b")
				}),
			],
			ctx,
		)
		expect(ctx.events).toEqual(["a", "b"])
		expect(ctx.value).toBe(10)
		expect(report.failures).toEqual([])
	})

	test("a failing stage is isolated — siblings still run, the report records it", async () => {
		const ctx: Ctx = { events: [], value: 0 }
		const warned: string[] = []
		const report = await runStages(
			[
				stage("boom", async () => {
					throw new Error("kaboom")
				}),
				stage("after", async (c) => {
					c.events.push("after")
				}),
			],
			ctx,
			{ onStageError: (label) => warned.push(label) },
		)
		expect(ctx.events).toEqual(["after"])
		expect(report.failures).toHaveLength(1)
		expect(report.failures[0]?.label).toBe("boom")
		expect(report.failures[0]?.error).toBeInstanceOf(Error)
		expect(warned).toEqual(["boom"])
	})

	test("parallel stages all run and share the report", async () => {
		const ctx: Ctx = { events: [], value: 0 }
		const report = await runStages(
			[
				stage("p1", async (c) => {
					c.events.push("p1")
				}),
				stage("boom", async () => {
					throw new Error("kaboom")
				}),
				stage("p2", async (c) => {
					c.events.push("p2")
				}),
			],
			ctx,
			{ parallel: true },
		)
		expect(ctx.events.sort()).toEqual(["p1", "p2"])
		expect(report.failures.map((f) => f.label)).toEqual(["boom"])
	})

	test("an empty stage list reports no failures", async () => {
		const ctx: Ctx = { events: [], value: 0 }
		expect((await runStages([], ctx)).failures).toEqual([])
	})

	test("failFast rethrows the first failure and skips the rest", async () => {
		const ctx: Ctx = { events: [], value: 0 }
		await expect(
			runStages(
				[
					stage("one", async (c) => {
						c.events.push("one")
					}),
					stage("boom", async () => {
						throw new Error("kaboom")
					}),
					stage("skipped", async (c) => {
						c.events.push("skipped")
					}),
				],
				ctx,
				{ failFast: true },
			),
		).rejects.toThrow("kaboom")
		expect(ctx.events).toEqual(["one"])
	})

	test("failFast records the failure in the report before throwing", async () => {
		const ctx: Ctx = { events: [], value: 0 }
		const warned: string[] = []
		try {
			await runStages(
				[
					stage("boom", async () => {
						throw new Error("kaboom")
					}),
				],
				ctx,
				{ failFast: true, onStageError: (label) => warned.push(label) },
			)
		} catch {
			// expected
		}
		expect(warned).toEqual(["boom"])
	})
})
