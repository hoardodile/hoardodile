import { PassThrough, Readable } from "node:stream"
import { afterEach, describe, expect, test, vi } from "vitest"
import { probeVideoMeta } from "./video.ts"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("probeVideoMeta", () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	test("ffprobe receives pipe:0 for stream sources", async () => {
		const { execa } = await import("execa")
		const payload = JSON.stringify({
			streams: [{ codec_type: "video", width: 640, height: 360 }],
			format: { duration: "1.5" },
		})
		vi.mocked(execa).mockReturnValue(
			Object.assign(
				Promise.resolve({
					stdout: payload,
					stderr: "",
					exitCode: 0,
				}),
				{ stdin: new PassThrough() },
			) as never,
		)

		const stream = Readable.from(Buffer.from("fake-video"))
		const meta = await probeVideoMeta(stream, "/bin/ffprobe", "mp4")
		const args = vi.mocked(execa).mock.calls[0]?.[1] as string[]
		expect(args).toContain("pipe:0")
		expect(args).toContain("-f")
		expect(args).toContain("mp4")
		expect(meta.width).toBe(640)
		expect(meta.height).toBe(360)
		expect(meta.durationMs).toBe(1500)
	})
})
