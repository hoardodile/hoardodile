import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useExistingImageSrc } from "./useExistingImageSrc"

/**
 * jsdom has no blob-URL factory — stub the two static methods so the
 * hook's object-URL behaviour can be asserted.
 */
function stubBlobUrls() {
	const create = vi.fn(() => "blob:mock-src")
	const revoke = vi.fn()
	Object.defineProperty(URL, "createObjectURL", {
		writable: true,
		configurable: true,
		value: create,
	})
	Object.defineProperty(URL, "revokeObjectURL", {
		writable: true,
		configurable: true,
		value: revoke,
	})
	return { create, revoke }
}

function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(impl)
	vi.stubGlobal("fetch", fetchMock)
	return fetchMock
}

/** Flush the hook's async fetch microtasks after a render / rerender. */
async function flush(): Promise<void> {
	await act(async () => {})
}

describe("useExistingImageSrc", () => {
	beforeEach(() => {
		stubBlobUrls()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("returns undefined while loading, then the object URL once the fetch succeeds", async () => {
		const fetchMock = stubFetch(
			async () => new Response(new Blob(["cover"]), { status: 200 }),
		)
		const { result } = renderHook(() =>
			useExistingImageSrc("/api/resources/r1/cover?size=original&format=image"),
		)
		expect(result.current).toBeUndefined()

		await flush()
		expect(result.current).toBe("blob:mock-src")
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/resources/r1/cover?size=original&format=image",
			expect.objectContaining({
				credentials: "include",
				cache: "no-store",
			}),
		)
	})

	it("does not fetch and stays undefined when the url is undefined", async () => {
		const fetchMock = stubFetch(
			async () => new Response(new Blob(["cover"]), { status: 200 }),
		)
		const { result } = renderHook(() => useExistingImageSrc(undefined))

		await flush()
		expect(result.current).toBeUndefined()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("stays undefined on a 404 and never creates an object URL", async () => {
		const fetchMock = stubFetch(
			async () => new Response("no image", { status: 404 }),
		)
		const { result } = renderHook(() =>
			useExistingImageSrc("/api/characters/c1/images/avatar"),
		)

		await flush()
		expect(result.current).toBeUndefined()
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(URL.createObjectURL).not.toHaveBeenCalled()
	})

	it("stays undefined when the fetch rejects", async () => {
		stubFetch(async () => {
			throw new Error("network")
		})
		const { result } = renderHook(() => useExistingImageSrc("/x"))

		await flush()
		expect(result.current).toBeUndefined()
	})

	it("revokes the previous object URL when the url changes", async () => {
		const fetchMock = stubFetch(
			async () => new Response(new Blob(["img"]), { status: 200 }),
		)
		const { create, revoke } = stubBlobUrls()
		create.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second")

		const { result, rerender } = renderHook(
			({ url }: { url: string | undefined }) => useExistingImageSrc(url),
			{ initialProps: { url: "/a" } },
		)
		await flush()
		expect(result.current).toBe("blob:first")

		rerender({ url: "/b" })
		await flush()
		expect(result.current).toBe("blob:second")
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(revoke).toHaveBeenCalledWith("blob:first")
	})

	it("revokes the current object URL on unmount", async () => {
		stubFetch(async () => new Response(new Blob(["img"]), { status: 200 }))
		const { create, revoke } = stubBlobUrls()
		create.mockReturnValueOnce("blob:only")

		const { result, unmount } = renderHook(() => useExistingImageSrc("/a"))
		await flush()
		expect(result.current).toBe("blob:only")

		unmount()
		expect(revoke).toHaveBeenCalledWith("blob:only")
	})
})
