import type { ListPageResult } from "@hoardodile/shared"
import { buildResThumbCacheKey } from "@hoardodile/shared"
import { createAdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import { describe, expect, test, vi } from "vitest"
import { type PrecacheDeps, runPrecache } from "./precache.ts"

type FakeItem = { readonly id: string; readonly updatedAt: number }

function pageOf<T>(rows: readonly T[], total: number): ListPageResult<T> {
	return { rows: [...rows], total, page: 1, size: rows.length }
}

function makeDeps(opts: {
	readonly resources: readonly FakeItem[]
	readonly characters?: readonly FakeItem[]
	readonly rebuildResourceFully?: PrecacheDeps["res"]["rebuildResourceFully"]
	readonly charThumbReady?: boolean
}) {
	const resources = opts.resources
	const characters = opts.characters ?? []
	const deps = {
		res: {
			list: async ({ page }: { page: number }) =>
				page === 1
					? pageOf(resources, resources.length)
					: pageOf([], resources.length),
			rebuildResourceFully:
				opts.rebuildResourceFully ??
				(async () => ({ coverReady: true, updatedAt: 123 })),
		},
		chars: {
			list: async ({ page }: { page: number }) =>
				page === 1
					? pageOf(characters, characters.length)
					: pageOf([], characters.length),
			getVariantVersion: async () => 1,
		},
		thumbs: {
			getCover: async () => ({
				kind: "ready" as const,
				path: "/tmp/cover.avif",
				format: "avif" as const,
			}),
			getCharacterThumb: async () =>
				opts.charThumbReady === false
					? { kind: "unavailable" as const, reason: "placeholder" as const }
					: {
							kind: "ready" as const,
							path: "/tmp/thumb.avif",
							format: "avif" as const,
						},
		},
		createConcurrency: () => createAdaptiveConcurrency({ max: 2, initial: 2 }),
	}
	return deps as unknown as PrecacheDeps
}

function makeHooks() {
	const events: Array<{
		phase: string
		current: number
		total: number
	}> = []
	return {
		events,
		onProgress: (
			phase: "resources" | "characters",
			current: number,
			total: number,
		) => {
			events.push({ phase, current, total })
		},
		isAborted: () => false,
	}
}

describe("runPrecache", () => {
	test("sweeps resources then characters and collects thumb URLs", async () => {
		const rebuildResourceFully = vi.fn(async (_id: string) => ({
			coverReady: true,
			updatedAt: 123,
		}))
		const deps = makeDeps({
			resources: [
				{ id: "r1", updatedAt: 1 },
				{ id: "r2", updatedAt: 2 },
			],
			characters: [{ id: "c1", updatedAt: 7 }],
			rebuildResourceFully,
		})
		const hooks = makeHooks()

		const result = await runPrecache(deps, hooks)

		expect(result).toBeDefined()
		expect(result?.resources).toMatchObject({
			total: 2,
			succeeded: 2,
			failed: 0,
		})
		const v = encodeURIComponent(buildResThumbCacheKey({ updatedAt: 123 }))
		expect(result?.resources.thumbUrls).toEqual([
			`/api/resources/r1/cover?v=${v}`,
			`/api/resources/r2/cover?v=${v}`,
		])
		expect(result?.characters.thumbUrls).toEqual([
			"/api/characters/c1/thumb/avatar?v=7",
			"/api/characters/c1/thumb/fullbody?v=7",
		])
		expect(rebuildResourceFully).toHaveBeenCalledTimes(2)
		expect(rebuildResourceFully.mock.calls[0]?.[0]).toBe("r1")
		expect(hooks.events).toContainEqual({
			phase: "resources",
			current: 2,
			total: 2,
		})
		expect(hooks.events).toContainEqual({
			phase: "characters",
			current: 1,
			total: 1,
		})
	})

	test("omits the thumb URL when the resource has no rendered cover", async () => {
		const deps = makeDeps({
			resources: [{ id: "r1", updatedAt: 1 }],
			rebuildResourceFully: async () => ({
				coverReady: false,
				updatedAt: 123,
			}),
		})

		const result = await runPrecache(deps, makeHooks())

		expect(result?.resources.succeeded).toBe(1)
		expect(result?.resources.thumbUrls).toEqual([])
	})

	test("collects per-item failures without aborting the sweep", async () => {
		const deps = makeDeps({
			resources: [
				{ id: "r1", updatedAt: 1 },
				{ id: "r2", updatedAt: 2 },
			],
			rebuildResourceFully: async (id) => {
				if (id === "r2") throw new Error("boom")
				return { coverReady: true, updatedAt: 123 }
			},
		})

		const result = await runPrecache(deps, makeHooks())

		expect(result?.resources.succeeded).toBe(1)
		expect(result?.resources.failed).toBe(1)
		expect(result?.resources.errors).toEqual([{ id: "r2", error: "boom" }])
		expect(result?.resources.thumbUrls).toHaveLength(1)
	})

	test("returns undefined when aborted before the sweep starts", async () => {
		const deps = makeDeps({ resources: [{ id: "r1", updatedAt: 1 }] })
		const listSpy = vi.spyOn(deps.res, "list")

		const result = await runPrecache(deps, {
			onProgress: () => {},
			isAborted: () => true,
		})

		expect(result).toBeUndefined()
		expect(listSpy).not.toHaveBeenCalled()
	})
})
