import { afterEach, describe, expect, it, vi } from "vitest"
import { uploadTagImage } from "./api"

// `vi.hoisted` keeps the mock above the hoisted stubGlobal call.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.stubGlobal("fetch", fetchMock)

afterEach(() => {
	fetchMock.mockReset()
})

describe("uploadTagImage", () => {
	it("PUTs the blob to the tag image slot with the server headers", async () => {
		fetchMock.mockResolvedValue(new Response("", { status: 201 }))

		const blob = new Blob(["png-bytes"], { type: "image/png" })
		await uploadTagImage("tag_1", blob, "image.png")

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(input).toBe("/api/tags/tag_1/images/image")
		expect(init.method).toBe("PUT")
		expect(init.credentials).toBe("include")
		expect(init.headers).toMatchObject({
			"content-type": "application/octet-stream",
			"x-filename": "image.png",
		})
		expect(init.body).toBe(blob)
	})

	it("throws with the server error text on a non-2xx response", async () => {
		fetchMock.mockResolvedValue(
			new Response("upload exceeds maximum size", { status: 413 }),
		)

		const err: unknown = await uploadTagImage(
			"tag_1",
			new Blob(["x"]),
			"a.png",
		).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Error)
		expect((err as Error).message).toBe("upload exceeds maximum size")
	})
})
