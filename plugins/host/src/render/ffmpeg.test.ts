import { describe, expect, test } from "vitest"
import { resolveFfmpegPaths } from "./ffmpeg.ts"

describe("resolveFfmpegPaths", () => {
	test("honours explicit FFMPEG_PATH / FFPROBE_PATH env overrides", () => {
		const paths = resolveFfmpegPaths({
			env: {
				FFMPEG_PATH: "C:/bin/ffmpeg.exe",
				FFPROBE_PATH: "C:/bin/ffprobe.exe",
			},
			loadStatic: () => "C:/static/ffmpeg.exe",
			loadStaticFfprobe: () => "C:/static/ffprobe.exe",
		})
		expect(paths).toEqual({
			ffmpeg: "C:/bin/ffmpeg.exe",
			ffprobe: "C:/bin/ffprobe.exe",
		})
	})

	test("uses the static installer path verbatim", () => {
		const paths = resolveFfmpegPaths({
			env: {},
			loadStatic: () =>
				"/node_modules/@hoardodile/ffmpeg-bin/bin/win32-x64/ffmpeg.exe",
			loadStaticFfprobe: () =>
				"/node_modules/@hoardodile/ffprobe-bin/bin/win32-x64/ffprobe.exe",
		})
		expect(paths.ffmpeg).toBe(
			"/node_modules/@hoardodile/ffmpeg-bin/bin/win32-x64/ffmpeg.exe",
		)
		expect(paths.ffprobe).toBe(
			"/node_modules/@hoardodile/ffprobe-bin/bin/win32-x64/ffprobe.exe",
		)
	})

	test("degrades to bare ffmpeg/ffprobe when the installer reports null", () => {
		const paths = resolveFfmpegPaths({
			env: {},
			loadStatic: () => null,
			loadStaticFfprobe: () => null,
		})
		expect(paths).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" })
	})

	test("degrades to bare ffmpeg/ffprobe when the installer is unavailable", () => {
		const paths = resolveFfmpegPaths({
			env: {},
			loadStatic: () => undefined,
			loadStaticFfprobe: () => undefined,
		})
		expect(paths).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" })
	})

	test("mixes one env override with a static fallback for the other binary", () => {
		const paths = resolveFfmpegPaths({
			env: { FFMPEG_PATH: "C:/bin/ffmpeg.exe" },
			loadStaticFfprobe: () => "/pkg/ffprobe",
		})
		expect(paths.ffmpeg).toBe("C:/bin/ffmpeg.exe")
		expect(paths.ffprobe).toBe("/pkg/ffprobe")
	})
})
