import { describe, expect, it } from "vitest"
import { buildIntrinsicStyle } from "./thumb-sizing"

describe("extreme cover dimensions", () => {
	it.each([
		{
			width: 8000,
			height: 8,
			bounds: { fitWidth: true, maxWidth: 280, maxHeight: 600 },
			expectedWidth: 280,
			expectedHeight: 0.28,
		},
		{
			width: 8,
			height: 8000,
			bounds: { fitWidth: true, maxWidth: 280, maxHeight: 600 },
			expectedWidth: 0.6,
			expectedHeight: 600,
		},
		{
			width: 8000,
			height: 8,
			bounds: { fitHeight: true, maxWidth: 400, maxHeight: 240 },
			expectedWidth: 400,
			expectedHeight: 0.4,
		},
		{
			width: 8,
			height: 8000,
			bounds: { fitHeight: true, maxWidth: 400, maxHeight: 240 },
			expectedWidth: 0.24,
			expectedHeight: 240,
		},
	])(
		"preserves subpixel artwork instead of rounding it to zero ($width x $height, $bounds)",
		({ width, height, bounds, expectedWidth, expectedHeight }) => {
			const style = buildIntrinsicStyle(width, height, bounds)
			expect(style.width).toBeCloseTo(expectedWidth)
			expect(style.height).toBeCloseTo(expectedHeight)
		},
	)
})
