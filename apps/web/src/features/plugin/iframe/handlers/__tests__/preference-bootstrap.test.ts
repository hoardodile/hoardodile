// @vitest-environment node
import { pluginMethods } from "@hoardodile/sdk-web"
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { pluginKeys } from "@/features/plugin/pluginApi"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutate } from "@/trpc/factory"
import { createHandlers } from "../preference"
import type { HostHandlerContext } from "../registry"

vi.mock("@/trpc/factory", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/trpc/factory")>()
	return { ...original, trpcMutate: vi.fn(async () => ({})) }
})
vi.mock("@/features/plugin/iframe/pushes", () => ({
	pushCacheChanged: vi.fn(),
	pushPrefsChanged: vi.fn(),
}))

type Bootstrap = RouterOutputs["plugin"]["previewInitContext"]
const initial: Bootstrap = {
	prefs: { mode: "scroll" },
	cache: { position: "3" },
	fileToken: "file-token",
	assetToken: "",
	assetVersion: "v1",
}
const context = {
	source: {} as Window,
	pluginId: "p-1",
	resId: "r-1",
} satisfies HostHandlerContext

function setup() {
	const qc = new QueryClient()
	for (const [pluginId, resId] of [
		["p-1", "r-1"],
		["p-1", "r-2"],
		["p-2", "r-1"],
	]) {
		qc.setQueryData(pluginKeys.previewInitContext(pluginId!, resId!), initial)
	}
	const handlers = createHandlers(qc)
	function run(method: string, params: { key: string; value: string }) {
		const entry = handlers.find((entry) => entry.method === method)
		if (entry === undefined) throw new Error("missing preference handler")
		return entry.handler(context, params)
	}
	return { qc, run }
}

describe("preview bootstrap after preference writes", () => {
	it("reopening a resource gets the saved position instead of the old bootstrap snapshot", async () => {
		const { qc, run } = setup()
		const queryKey = pluginKeys.previewInitContext("p-1", "r-1")
		qc.setQueryData(queryKey, initial, { updatedAt: 1234 })
		const saving = run(pluginMethods.setCache, { key: "position", value: "1" })
		expect(qc.getQueryData<Bootstrap>(queryKey)?.cache.position).toBe("1")
		await saving
		expect(qc.getQueryState(queryKey)?.dataUpdatedAt).toBe(1234)
		expect(
			qc.getQueryData(pluginKeys.previewInitContext("p-1", "r-1")),
		).toEqual({ ...initial, cache: { position: "1" } })
		expect(
			qc.getQueryData(pluginKeys.previewInitContext("p-1", "r-2")),
		).toEqual(initial)
		expect(
			qc.getQueryData(pluginKeys.previewInitContext("p-2", "r-1")),
		).toEqual(initial)
	})
	it("new instances of the same plugin receive its changed preference", async () => {
		const { qc, run } = setup()
		for (const resId of ["r-1", "r-2"])
			qc.setQueryData(pluginKeys.previewInitContext("p-1", resId), initial, {
				updatedAt: 1234,
			})
		await run(pluginMethods.setPref, { key: "mode", value: "paged" })
		for (const resId of ["r-1", "r-2"])
			expect(
				qc.getQueryState(pluginKeys.previewInitContext("p-1", resId))
					?.dataUpdatedAt,
			).toBe(1234)
		for (const resId of ["r-1", "r-2"])
			expect(
				qc.getQueryData(pluginKeys.previewInitContext("p-1", resId)),
			).toEqual({ ...initial, prefs: { mode: "paged" } })
		expect(
			qc.getQueryData(pluginKeys.previewInitContext("p-2", "r-1")),
		).toEqual(initial)
	})
	it("empty values are removed from bootstrap records", async () => {
		const { qc, run } = setup()
		await run(pluginMethods.setCache, { key: "position", value: "" })
		await run(pluginMethods.setPref, { key: "mode", value: "" })
		expect(
			qc.getQueryData(pluginKeys.previewInitContext("p-1", "r-1")),
		).toEqual({ ...initial, prefs: {}, cache: {} })
	})
	it("a failed write makes the optimistic snapshot stale before the next open", async () => {
		const { qc, run } = setup()
		vi.mocked(trpcMutate).mockRejectedValueOnce(new Error("save failed"))
		await expect(
			run(pluginMethods.setCache, { key: "position", value: "1" }),
		).rejects.toThrow("save failed")
		expect(
			qc.getQueryState(pluginKeys.previewInitContext("p-1", "r-1"))
				?.isInvalidated,
		).toBe(true)
		expect(
			qc.getQueryState(pluginKeys.previewInitContext("p-1", "r-2"))
				?.isInvalidated,
		).toBe(false)
	})
})
