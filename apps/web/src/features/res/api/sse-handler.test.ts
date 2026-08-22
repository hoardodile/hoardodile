/**
 * @vitest-environment node
 */

import { QueryClient } from "@tanstack/react-query"
import { describe, expect, test, vi } from "vitest"
import { stubResCard } from "@/test/stubs/cards"
import { type ResCardListResult, resKeys } from "./index"
import { patchResMetaInCache } from "./patch-res-meta"
import { handleResourceMetaUpdated } from "./sse-handler"

describe("handleResourceMetaUpdated", () => {
	test("patches fileStats in list cache without refetching detailCard", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const card = stubResCard("res-1", "One", {
			fileStats: { count: 1, sizeBytes: 10 },
		})
		const listKey = resKeys.listCards({
			trash: false,
			query: "",
			page: 1,
		})
		queryClient.setQueryData(listKey, {
			rows: [card],
			total: 1,
			page: 1,
			size: 24,
		})

		const fetchSpy = vi.spyOn(queryClient, "fetchQuery")

		handleResourceMetaUpdated(queryClient, {
			type: "resourceMetaUpdated",
			resourceId: "res-1",
			metaTypes: ["fileStats"],
			meta: { fileStats: { count: 3, sizeBytes: 30 } },
		})

		expect(fetchSpy).not.toHaveBeenCalled()
		const cached = queryClient.getQueryData<ResCardListResult>(listKey)
		expect(cached?.rows[0]?.fileStats).toEqual({ count: 3, sizeBytes: 30 })
	})

	test("invalidates the similar/duplicate queries on imageHashes", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		queryClient.setQueryData(resKeys.similarImages("res-1"), [
			{
				resource: stubResCard("res-2", "Two"),
				files: [{ scope: "1.jpg", bits: 64, distance: 3 }],
			},
		])
		queryClient.setQueryData(resKeys.similarWithin("res-1"), [
			{
				files: [{ scope: "1.jpg", bits: 64, distance: 3 }],
			},
		])
		queryClient.setQueryData(resKeys.duplicateImages("res-1"), [
			{
				resource: stubResCard("res-2", "Two"),
				files: [{ scope: "1.jpg", otherScope: "1.jpg", type: "sha256" }],
			},
		])

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

		handleResourceMetaUpdated(queryClient, {
			type: "resourceMetaUpdated",
			resourceId: "res-1",
			metaTypes: ["imageHashes"],
			meta: { hashesMeta: { v: 1 } },
		})

		expect(invalidateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["resource", "similarImages", "res-1"],
			}),
		)
		expect(invalidateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["resource", "similarWithin", "res-1"],
			}),
		)
		expect(invalidateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: ["resource", "duplicateImages", "res-1"],
			}),
		)
	})
})

describe("patchResMetaInCache", () => {
	test("clears coverMeta when snapshot value is null", () => {
		const queryClient = new QueryClient()
		const card = stubResCard("res-1", "One", {
			coverMeta: { kind: "image", width: 100, height: 100 },
		})
		queryClient.setQueryData(resKeys.detailCard("res-1"), card)

		patchResMetaInCache(queryClient, "res-1", { coverMeta: null })

		const next = queryClient.getQueryData<typeof card>(
			resKeys.detailCard("res-1"),
		)
		expect(next?.coverMeta).toBeUndefined()
	})
})
