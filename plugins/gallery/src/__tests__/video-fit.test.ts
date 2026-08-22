// @vitest-environment node

import { describe, expect, it } from "vitest"
import { initialAspectRatio, resolveVideoFit } from "../danmaku/video-fit"

describe("initialAspectRatio", () => {
	it("uses the probed dimensions when sourceMeta knows them", () => {
		expect(initialAspectRatio({ w: 1280, h: 720 })).toBe("1280 / 720")
	})

	it("falls back to 16:9 so the surface never collapses", () => {
		expect(initialAspectRatio(undefined)).toBe(String(16 / 9))
	})
})

describe("resolveVideoFit", () => {
	it("letterboxes to fill in contain mode", () => {
		const fit = resolveVideoFit({
			fitMode: "contain",
			natural: { w: 320, h: 240 },
			naturalSize: { w: 320, h: 240 },
		})
		expect(fit.className).toContain("h-full w-full")
		expect(fit.style.aspectRatio).toBe("320 / 240")
		expect(fit.style.maxWidth).toBeUndefined()
	})

	it("caps at the source resolution in natural mode", () => {
		const fit = resolveVideoFit({
			fitMode: "natural",
			natural: { w: 320, h: 240 },
			naturalSize: undefined,
		})
		expect(fit.className).toContain("h-auto w-auto")
		expect(fit.style.maxWidth).toBe("min(100%, 320px)")
		expect(fit.style.maxHeight).toBe("min(100%, 240px)")
		expect(fit.style.aspectRatio).toBe("320 / 240")
	})

	it("stays in contain mode until the source resolution is known", () => {
		const fit = resolveVideoFit({
			fitMode: "natural",
			natural: undefined,
			naturalSize: { w: 640, h: 360 },
		})
		expect(fit.className).toContain("h-full w-full")
		expect(fit.style.aspectRatio).toBe("640 / 360")
	})
})
