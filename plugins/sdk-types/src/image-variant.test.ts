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
			preserveTransparentRgb: false,
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
			preserveTransparentRgb: true,
		})
	})

	/**
	 * `exact` promises a pure format change — the same pixels with the same
	 * meaning. Model atlases keep their edge bleed in transparent pixels,
	 * so the transcode must not let libwebp clean it away.
	 */
	test("only the exact fit preserves transparent-area RGB", () => {
		expect(
			normalizeImageVariantSpec({ fit: "exact" }, QUALITY_DEFAULTS)
				.preserveTransparentRgb,
		).toBe(true)
		expect(
			normalizeImageVariantSpec({ fit: "inside" }, QUALITY_DEFAULTS)
				.preserveTransparentRgb,
		).toBe(false)
		expect(
			normalizeImageVariantSpec({}, QUALITY_DEFAULTS).preserveTransparentRgb,
		).toBe(false)
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

	test("the transparent-RGB flag is part of the cache identity", () => {
		// Same request parameters, different encoded bytes: the two must not
		// share a cached artifact.
		const cleaned = normalizeImageVariantSpec(
			{ format: "webp", fit: "inside", quality: 90 },
			QUALITY_DEFAULTS,
		)
		const preserved = normalizeImageVariantSpec(
			{ format: "webp", fit: "exact", quality: 90 },
			QUALITY_DEFAULTS,
		)
		expect(imageVariantCanonical(cleaned)).toContain("clean")
		expect(imageVariantCanonical(preserved)).toContain("rgba")
		expect(imageVariantCanonical(cleaned)).not.toBe(
			imageVariantCanonical(preserved),
		)
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
