import { describe, expect, it } from "vitest"
import {
	type ResumeWriter,
	resumeCacheKey,
	writeResume,
} from "../danmaku/resume"

function createWriter(): {
	readonly writer: ResumeWriter
	readonly calls: { key: string; value: string }[]
} {
	const calls: { key: string; value: string }[] = []
	return {
		writer: {
			setCache(key, value) {
				calls.push({ key, value })
			},
		},
		calls,
	}
}

describe("resumeCacheKey", () => {
	it("uses a bare key for single-file resources", () => {
		expect(resumeCacheKey("")).toBe("resume")
	})

	it("scopes the key by filename within the resource", () => {
		expect(resumeCacheKey("a.mp4")).toBe("resume:a.mp4")
	})
})

describe("writeResume", () => {
	it("stores the offset past the one-second floor", () => {
		const { writer, calls } = createWriter()
		writeResume(writer, {
			filename: "a.mp4",
			currentMs: 42_000,
			durationMs: 120_000,
		})
		expect(calls).toEqual([{ key: "resume:a.mp4", value: "42000" }])
	})

	it("skips positions under one second", () => {
		const { writer, calls } = createWriter()
		writeResume(writer, {
			filename: "a.mp4",
			currentMs: 500,
			durationMs: 120_000,
		})
		expect(calls).toEqual([])
	})

	it("clears the offset near the end of the media", () => {
		const { writer, calls } = createWriter()
		writeResume(writer, {
			filename: "a.mp4",
			currentMs: 119_999,
			durationMs: 120_000,
		})
		expect(calls).toEqual([{ key: "resume:a.mp4", value: "" }])
	})
})
