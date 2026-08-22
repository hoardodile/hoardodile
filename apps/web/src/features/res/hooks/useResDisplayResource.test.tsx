import { populatedCover } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { resKeys } from "@/features/res/api"
import type { ResMediaThumbResource } from "@/features/res/hooks/useResDisplayResource"
import {
	mergeResMetaFields,
	needsResMeta,
	useResDisplayResource,
} from "@/features/res/hooks/useResDisplayResource"
import { stubResCard } from "@/test/stubs/cards"

const GALLERY_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"

function thumbResource(
	overrides?: Partial<ResMediaThumbResource>,
): ResMediaThumbResource {
	const card = stubResCard("res-1", "One", overrides)
	return {
		id: card.id,
		name: card.name,
		contentPluginId: card.contentPluginId,
		coverMeta: card.coverMeta,
		sourceMeta: card.sourceMeta,
		searchMeta: card.searchMeta,
		fileStats: card.fileStats,
		updatedAt: card.updatedAt,
	}
}

describe("needsResMeta", () => {
	it("is false when contentPluginId is null", () => {
		expect(needsResMeta(thumbResource({ contentPluginId: null }))).toBe(false)
	})

	it("is false when both coverMeta and sourceMeta are present", () => {
		expect(
			needsResMeta(
				thumbResource({
					contentPluginId: GALLERY_PLUGIN_ID,
					coverMeta: { kind: "image", width: 100, height: 80 },
					sourceMeta: { width: 1920, height: 1080 },
				}),
			),
		).toBe(false)
	})

	it("is true when plugin is set but coverMeta is missing", () => {
		expect(
			needsResMeta(
				thumbResource({
					contentPluginId: GALLERY_PLUGIN_ID,
					sourceMeta: { width: 100, height: 100 },
				}),
			),
		).toBe(true)
	})

	it("is false when coverMeta is the computed-empty sentinel and sourceMeta is present", () => {
		expect(
			needsResMeta(
				thumbResource({
					contentPluginId: GALLERY_PLUGIN_ID,
					coverMeta: { empty: true },
					sourceMeta: { width: 100, height: 100 },
				}),
			),
		).toBe(false)
	})

	it("is true when plugin is set but sourceMeta is missing", () => {
		expect(
			needsResMeta(
				thumbResource({
					contentPluginId: GALLERY_PLUGIN_ID,
					coverMeta: { kind: "image", width: 100, height: 80 },
				}),
			),
		).toBe(true)
	})
})

describe("mergeResMetaFields", () => {
	it("overlays meta fields from detailCard onto the list prop", () => {
		const base = thumbResource({
			contentPluginId: GALLERY_PLUGIN_ID,
		})
		const merged = mergeResMetaFields(base, {
			coverMeta: { kind: "image", width: 200, height: 150 },
			sourceMeta: { width: 1920, height: 1080 },
			searchMeta: { v: 1, facets: { image: true } },
			fileStats: { count: 3, sizeBytes: 9000 },
			updatedAt: 200,
		})
		expect(merged.coverMeta).toEqual({
			kind: "image",
			width: 200,
			height: 150,
		})
		expect(merged.sourceMeta).toEqual({ width: 1920, height: 1080 })
		expect(merged.searchMeta).toEqual({ v: 1, facets: { image: true } })
		expect(merged.fileStats).toEqual({ count: 3, sizeBytes: 9000 })
		expect(merged.updatedAt).toBe(200)
		expect(merged.id).toBe("res-1")
	})
})

const trpcQuery = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null))

vi.mock("@/trpc/factory", () => ({
	trpcQuery: (...args: unknown[]) => trpcQuery(...args),
	trpcMutation: vi.fn(),
	idMutation: vi.fn(),
}))

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		)
	}
}

describe("useResDisplayResource", () => {
	it("returns the prop unchanged when meta is already complete", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const resource = thumbResource({
			contentPluginId: GALLERY_PLUGIN_ID,
			coverMeta: { kind: "image", width: 100, height: 80 },
			sourceMeta: { width: 640, height: 480 },
		})

		const { result } = renderHook(() => useResDisplayResource(resource), {
			wrapper: createWrapper(queryClient),
		})

		expect(result.current).toBe(resource)
		expect(trpcQuery).not.toHaveBeenCalled()
	})

	it("fetches detailCard and merges meta when the prop is incomplete", async () => {
		trpcQuery.mockReset()
		const detailCard = stubResCard("res-1", "One", {
			contentPluginId: GALLERY_PLUGIN_ID,
			coverMeta: { kind: "image", width: 320, height: 240 },
			sourceMeta: { width: 1920, height: 1080 },
		})
		trpcQuery.mockResolvedValue(detailCard)

		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const resource = thumbResource({
			contentPluginId: GALLERY_PLUGIN_ID,
		})

		const { result } = renderHook(() => useResDisplayResource(resource), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => {
			expect(result.current.coverMeta).toEqual({
				kind: "image",
				width: 320,
				height: 240,
			})
		})
		expect(result.current.sourceMeta).toEqual({ width: 1920, height: 1080 })
		expect(trpcQuery).toHaveBeenCalledWith("resource", "detailCard", {
			id: "res-1",
		})
	})

	it("follows detailCard cache updates without refetching", async () => {
		trpcQuery.mockReset()
		const initial = stubResCard("res-1", "One", {
			contentPluginId: GALLERY_PLUGIN_ID,
			coverMeta: { kind: "image", width: 100, height: 80 },
		})
		trpcQuery.mockResolvedValue(initial)

		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const resource = thumbResource({
			contentPluginId: GALLERY_PLUGIN_ID,
		})

		const { result } = renderHook(() => useResDisplayResource(resource), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => {
			expect(populatedCover(result.current.coverMeta)?.width).toBe(100)
		})

		queryClient.setQueryData(resKeys.detailCard("res-1"), {
			...initial,
			sourceMeta: { width: 1280, height: 720 },
		})

		await waitFor(() => {
			expect(result.current.sourceMeta).toEqual({ width: 1280, height: 720 })
		})
		expect(trpcQuery).toHaveBeenCalledTimes(1)
	})
})
