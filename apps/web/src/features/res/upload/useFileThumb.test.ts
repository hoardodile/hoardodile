import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ThumbState, useFileThumb } from "./useFileThumb"

/**
 * jsdom has no blob-URL factory — stub the two static methods so the
 * hook's object-URL cache behaves like the browser.
 */
type Props = { id: string | undefined; enabled: boolean }

type FileProps = { id: string | undefined; file: File; enabled: boolean }

function stubBlobUrls(): void {
	Object.defineProperty(URL, "createObjectURL", {
		writable: true,
		value: vi.fn(() => "blob:mock-preview"),
	})
	Object.defineProperty(URL, "revokeObjectURL", {
		writable: true,
		value: vi.fn(),
	})
}

function imageFile(): File {
	return new File(["x"], "photo.png", { type: "image/png" })
}

function stubFetch(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(
		async () => new Response(new Blob(["img"]), { status: 200 }),
	)
	vi.stubGlobal("fetch", fetchMock)
	return fetchMock
}

/** Advance the preview debounce (300ms) and flush the resulting promise. */
async function settleDebounce(): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(500)
	})
}

describe("useFileThumb", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		stubBlobUrls()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("fetches once a file is staged and never again for the same file", async () => {
		const fetchMock = stubFetch()
		const file = imageFile()

		const { result, rerender } = renderHook<ThumbState, Props>(
			({ id, enabled }) => useFileThumb(id, file, enabled),
			{ initialProps: { id: undefined, enabled: true } },
		)
		expect(result.current.kind).toBe("loading")

		// The file finishes staging: its own fileId appears.
		rerender({ id: "file-id-1", enabled: true })
		await settleDebounce()
		expect(result.current.kind).toBe("ready")
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/uploads/staged/file-id-1/preview",
			expect.objectContaining({ credentials: "include" }),
		)

		// Reorder-style re-renders (same file, same fileId, viewport flips)
		// must reuse the cached object URL — no new fetch, no flicker.
		rerender({ id: "file-id-1", enabled: false })
		rerender({ id: "file-id-1", enabled: true })
		await settleDebounce()
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(result.current.kind).toBe("ready")
		expect(result.current.kind === "ready" ? result.current.url : "").toBe(
			"blob:mock-preview",
		)
	})

	it("does not fetch until the file is staged", async () => {
		const fetchMock = stubFetch()
		const file = imageFile()
		const { result, rerender } = renderHook<ThumbState, Props>(
			({ id, enabled }) => useFileThumb(id, file, enabled),
			{ initialProps: { id: undefined, enabled: true } },
		)
		await settleDebounce()
		expect(result.current.kind).toBe("loading")
		expect(fetchMock).not.toHaveBeenCalled()

		rerender({ id: "file-id-2", enabled: true })
		await settleDebounce()
		expect(result.current.kind).toBe("ready")
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("fetches again when a different file replaces the entry", async () => {
		const fetchMock = stubFetch()
		const first = imageFile()
		const second = imageFile()

		const { result, rerender } = renderHook<ThumbState, FileProps>(
			({ id, file, enabled }) => useFileThumb(id, file, enabled),
			{ initialProps: { id: "file-id-3", file: first, enabled: true } },
		)
		await settleDebounce()
		expect(result.current.kind).toBe("ready")
		expect(fetchMock).toHaveBeenCalledTimes(1)

		rerender({ id: "file-id-3", file: second, enabled: true })
		await settleDebounce()
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(result.current.kind).toBe("ready")
	})

	it("stays loading while the tile is off-screen", async () => {
		const fetchMock = stubFetch()
		const file = imageFile()
		const { result, rerender } = renderHook<ThumbState, Props>(
			({ id, enabled }) => useFileThumb(id, file, enabled),
			{ initialProps: { id: "file-id-4", enabled: false } },
		)
		await settleDebounce()
		expect(result.current.kind).toBe("loading")
		expect(fetchMock).not.toHaveBeenCalled()

		rerender({ id: "file-id-4", enabled: true })
		await settleDebounce()
		expect(result.current.kind).toBe("ready")
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})
