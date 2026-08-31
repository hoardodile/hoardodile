/**
 * @vitest-environment node
 */

import { pluginMethods } from "@hoardodile/sdk-web"
import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiPaths } from "@/lib/paths"
import type { HostHandlerContext } from "../registry"

const { mockApiPutBlob, mockInvalidate } = vi.hoisted(() => ({
	mockApiPutBlob: vi.fn(),
	mockInvalidate: vi.fn(async () => {}),
}))

vi.mock("@/lib/http", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/http")>()
	return { ...actual, apiPutBlob: mockApiPutBlob }
})

vi.mock("@/features/res/api", () => ({
	invalidateResources: mockInvalidate,
}))

import { createHandlers } from "../cover"

const ctx = {
	source: {} as Window,
	resId: "r-1",
	pluginId: "p-1",
} satisfies HostHandlerContext

const handlers = createHandlers(new QueryClient())
const uploadHandler = handlers.find(
	(e) => e.method === pluginMethods.uploadCover,
)
if (uploadHandler === undefined) throw new Error("uploadCover handler missing")

beforeEach(() => {
	vi.clearAllMocks()
	mockApiPutBlob.mockReset()
	mockInvalidate.mockReset()
})

describe("plugin uploadCover handler", () => {
	it("uploads an ArrayBuffer cover with the cover URL, octet-stream and filename", async () => {
		mockApiPutBlob.mockResolvedValueOnce({ ok: true })

		const result = await uploadHandler.handler(ctx, {
			file: new ArrayBuffer(4),
			filename: "cover.png",
		})

		expect(mockApiPutBlob).toHaveBeenCalledWith(
			apiPaths.resources.cover(ctx.resId),
			expect.any(Blob),
			"cover.png",
			"application/octet-stream",
		)
		expect(mockInvalidate).toHaveBeenCalledWith(expect.any(QueryClient), "r-1")
		expect(result).toEqual({ path: apiPaths.resources.cover(ctx.resId) })
	})

	it("passes a Blob through unchanged and forwards an optional mimeType", async () => {
		mockApiPutBlob.mockResolvedValueOnce({ ok: true })
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })

		await uploadHandler.handler(ctx, {
			file: blob,
			filename: "cover.jpeg",
			mimeType: "image/jpeg",
		})

		expect(mockApiPutBlob).toHaveBeenCalledWith(
			apiPaths.resources.cover(ctx.resId),
			blob,
			"cover.jpeg",
			"application/octet-stream",
		)
		expect(mockInvalidate).toHaveBeenCalledTimes(1)
	})

	it("throws the server error text on a failed upload and does not invalidate", async () => {
		mockApiPutBlob.mockResolvedValueOnce({
			ok: false,
			status: 415,
			text: async () => "unsupported cover extension: .gif",
		})

		await expect(
			uploadHandler.handler(ctx, {
				file: new ArrayBuffer(2),
				filename: "a.gif",
			}),
		).rejects.toThrow("unsupported cover extension: .gif")
		expect(mockInvalidate).not.toHaveBeenCalled()
	})

	it("falls back to the status text when the failure body is empty", async () => {
		mockApiPutBlob.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: async () => "",
		})

		await expect(
			uploadHandler.handler(ctx, {
				file: new ArrayBuffer(2),
				filename: "a.png",
			}),
		).rejects.toThrow("cover upload failed (500)")
	})
})
