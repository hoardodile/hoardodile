import { describe, expect, test } from "vitest"
import {
	imageVariantCanonical,
	imageVariantQuery,
	normalizeImageVariantSpec,
	parseImageVariantQuery,
} from "./image-variant.ts"
import { RESOURCE_PREVIEW_MAX_AREA } from "./resource.ts"

const QUALITY_DEFAULTS = { avifQuality: 65, webpQuality: 90 }

describe("parseImageVariantQuery", () => {
	test("no variant parameters means the original", () => {
		expect(parseImageVariantQuery({})).toEqual({ kind: "none" })
		expect(parseImageVariantQuery({ size: "original" })).toEqual({
			kind: "none",
		})
	})

	test("size=preview alone requests the default variant", () => {
		expect(parseImageVariantQuery({ size: "preview" })).toEqual({
			kind: "variant",
			spec: {},
		})
	})

	test("any variant parameter requests a variant", () => {
		const result = parseImageVariantQuery({
			size: "preview",
			fmt: "webp",
			fit: "exact",
			area: "2000000",
			q: "80",
		})
		expect(result).toEqual({
			kind: "variant",
			spec: { format: "webp", fit: "exact", maxArea: 2000000, quality: 80 },
		})
	})

	test("numeric strings are coerced", () => {
		expect(parseImageVariantQuery({ area: "4000000", q: 50 })).toEqual({
			kind: "variant",
			spec: { maxArea: 4000000, quality: 50 },
		})
	})

	test("invalid format, fit, area and quality are rejected", () => {
		expect(parseImageVariantQuery({ fmt: "png" })).toMatchObject({
			kind: "invalid",
		})
		expect(parseImageVariantQuery({ fit: "cover" })).toMatchObject({
			kind: "invalid",
		})
		expect(parseImageVariantQuery({ area: "0" })).toMatchObject({
			kind: "invalid",
		})
		expect(parseImageVariantQuery({ area: "1.5" })).toMatchObject({
			kind: "invalid",
		})
		expect(parseImageVariantQuery({ q: "101" })).toMatchObject({
			kind: "invalid",
		})
		expect(parseImageVariantQuery({ q: "abc" })).toMatchObject({
			kind: "invalid",
		})
	})
})

describe("normalizeImageVariantSpec", () => {
	test("empty spec fills every default", () => {
		expect(normalizeImageVariantSpec({}, QUALITY_DEFAULTS)).toEqual({
			format: "avif",
			fit: "inside",
			maxArea: RESOURCE_PREVIEW_MAX_AREA,
			avifQuality: 65,
			webpQuality: 90,
		})
	})

	test("quality maps onto both per-format qualities", () => {
		const resolved = normalizeImageVariantSpec(
			{ format: "webp", fit: "exact", quality: 80 },
			QUALITY_DEFAULTS,
		)
		expect(resolved).toEqual({
			format: "webp",
			fit: "exact",
			maxArea: RESOURCE_PREVIEW_MAX_AREA,
			avifQuality: 80,
			webpQuality: 80,
		})
	})

	test("out-of-range values are clamped, not rejected", () => {
		const resolved = normalizeImageVariantSpec(
			{ maxArea: 0, quality: 500 },
			QUALITY_DEFAULTS,
		)
		expect(resolved.maxArea).toBe(1)
		expect(resolved.avifQuality).toBe(100)
		expect(resolved.webpQuality).toBe(100)
	})
})

describe("imageVariantCanonical", () => {
	test("identical variants share one canonical string", () => {
		const a = normalizeImageVariantSpec(
			{ format: "webp", fit: "exact", quality: 80 },
			QUALITY_DEFAULTS,
		)
		// The explicit area equals the default, so both requests render
		// identically and must share a cache identity.
		const b = normalizeImageVariantSpec(
			{
				format: "webp",
				fit: "exact",
				maxArea: RESOURCE_PREVIEW_MAX_AREA,
				quality: 80,
			},
			QUALITY_DEFAULTS,
		)
		expect(imageVariantCanonical(a)).toBe(imageVariantCanonical(b))
	})

	test("different qualities diverge", () => {
		const a = normalizeImageVariantSpec({ quality: 80 }, QUALITY_DEFAULTS)
		const b = normalizeImageVariantSpec({ quality: 81 }, QUALITY_DEFAULTS)
		expect(imageVariantCanonical(a)).not.toBe(imageVariantCanonical(b))
	})
})

describe("imageVariantQuery", () => {
	test("always carries size=preview so old servers degrade safely", () => {
		expect(imageVariantQuery({})).toBe("size=preview")
		expect(
			imageVariantQuery({ format: "webp", fit: "exact", quality: 80 }),
		).toBe("size=preview&fmt=webp&fit=exact&q=80")
	})
})
