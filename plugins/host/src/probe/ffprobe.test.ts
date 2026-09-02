import { describe, expect, test } from "vitest"
import { resolveFfprobePath } from "./ffprobe.ts"

describe("resolveFfprobePath", () => {
	test("honours an explicit FFPROBE_PATH env override", () => {
		const path = resolveFfprobePath({
			env: { FFPROBE_PATH: "C:/bin/ffprobe.exe" },
			loadStatic: () => "C:/static/ffprobe.exe",
		})
		expect(path).toBe("C:/bin/ffprobe.exe")
	})

	test("uses the static installer path verbatim", () => {
		const path = resolveFfprobePath({
			env: {},
			loadStatic: () =>
				"/node_modules/@hoardodile/ffprobe-bin/bin/win32-x64/ffprobe.exe",
		})
		expect(path).toBe(
			"/node_modules/@hoardodile/ffprobe-bin/bin/win32-x64/ffprobe.exe",
		)
	})

	test("degrades to bare ffprobe when the installer reports null", () => {
		const path = resolveFfprobePath({ env: {}, loadStatic: () => null })
		expect(path).toBe("ffprobe")
	})

	test("degrades to bare ffprobe when the installer is unavailable", () => {
		const path = resolveFfprobePath({
			env: {},
			loadStatic: () => undefined,
		})
		expect(path).toBe("ffprobe")
	})
})
