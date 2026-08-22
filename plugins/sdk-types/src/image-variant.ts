/**
 * Image variant contract: how a plugin asks the host to derive an image
 * from a resource file, and how that request travels on the wire.
 *
 * One {@link ImageVariantSpec} has three projections, all derived from
 * this module:
 *
 * - the URL query (`imageVariantQuery`) the iframe client emits,
 * - the resolved render spec (`normalizeImageVariantSpec`) the
 *   pipelines execute,
 * - the canonical cache identity (`imageVariantCanonical`) that keys
 *   the on-disk caches.
 *
 * The per-format encode qualities are pipeline constants, not part of
 * the wire contract — callers fill them in at the render boundary, so
 * this module stays dependency-free and browser-safe.
 */
import { RESOURCE_PREVIEW_MAX_AREA } from "./resource.ts"

export const IMAGE_VARIANT_FORMATS = ["avif", "webp"] as const
export type ImageVariantFormat = (typeof IMAGE_VARIANT_FORMATS)[number]

/**
 * How the source image is fitted into the variant:
 * - `inside` — downscaled (never upscaled) to fit within `maxArea`;
 * - `exact` — transcode only: output pixels are exactly the source
 *   dimensions (needed when downstream code maps coordinates onto the
 *   texture, e.g. Live2D models).
 */
export const IMAGE_VARIANT_FITS = ["inside", "exact"] as const
export type ImageVariantFit = (typeof IMAGE_VARIANT_FITS)[number]

/** Upper bound for the `area` query param (bounded cache-key space). */
export const IMAGE_VARIANT_MAX_AREA = 1_000_000_000

/** Encode-quality range for the `q` query param. */
export const IMAGE_VARIANT_MIN_QUALITY = 1
export const IMAGE_VARIANT_MAX_QUALITY = 100

/**
 * Client-declared variant request. Every field is optional; omitted
 * fields fall back to the defaults (`format` avif, `fit` inside,
 * `maxArea` {@link RESOURCE_PREVIEW_MAX_AREA}, per-format quality).
 * `maxArea` only has an effect when `fit` is `inside`; it is carried
 * through (and cached under) regardless so URL identity stays stable.
 */
export type ImageVariantSpec = {
	readonly format?: ImageVariantFormat
	readonly fit?: ImageVariantFit
	readonly maxArea?: number
	readonly quality?: number
}

/**
 * A fully resolved variant: every field concrete, including the
 * per-format encode qualities the pipeline consumes. This is the render
 * boundary shape and the input to {@link imageVariantCanonical}.
 */
export type ResolvedImageVariant = {
	readonly format: ImageVariantFormat
	readonly fit: ImageVariantFit
	readonly maxArea: number
	readonly webpQuality: number
	readonly avifQuality: number
}

/** Query parameters accepted by the resource file route. */
export type ImageVariantQuery = {
	readonly size?: string
	readonly fmt?: string
	readonly fit?: string
	readonly area?: string | number
	readonly q?: string | number
}

export type ImageVariantParseResult =
	| { readonly kind: "none" }
	| { readonly kind: "variant"; readonly spec: ImageVariantSpec }
	| { readonly kind: "invalid"; readonly reason: string }

export function isImageVariantFormat(
	value: string,
): value is ImageVariantFormat {
	return IMAGE_VARIANT_FORMATS.some((format) => format === value)
}

export function isImageVariantFit(value: string): value is ImageVariantFit {
	return IMAGE_VARIANT_FITS.some((fit) => fit === value)
}

/**
 * Interpret the file route's query. A variant is requested when
 * `size=preview` (the compatibility alias) or any variant parameter is
 * present; otherwise the route serves the original bytes.
 * Returns `invalid` for out-of-range or malformed values.
 */
export function parseImageVariantQuery(
	query: ImageVariantQuery,
): ImageVariantParseResult {
	const requested =
		query.size === "preview" ||
		query.fmt !== undefined ||
		query.fit !== undefined ||
		query.area !== undefined ||
		query.q !== undefined
	if (!requested) return { kind: "none" }

	let format: ImageVariantFormat | undefined
	let fit: ImageVariantFit | undefined
	let maxArea: number | undefined
	let quality: number | undefined
	if (query.fmt !== undefined) {
		if (!isImageVariantFormat(query.fmt)) {
			return invalidFormat(query.fmt)
		}
		format = query.fmt
	}
	if (query.fit !== undefined) {
		if (!isImageVariantFit(query.fit)) {
			return invalidFit(query.fit)
		}
		fit = query.fit
	}
	if (query.area !== undefined) {
		const area = parseVariantInteger(query.area, IMAGE_VARIANT_MAX_AREA)
		if (area === undefined) return invalidArea(query.area)
		maxArea = area
	}
	if (query.q !== undefined) {
		const q = parseVariantInteger(query.q, IMAGE_VARIANT_MAX_QUALITY)
		if (q === undefined) return invalidQuality(query.q)
		quality = q
	}
	return { kind: "variant", spec: { format, fit, maxArea, quality } }
}

function invalidFormat(value: string): ImageVariantParseResult {
	return {
		kind: "invalid",
		reason: `invalid format "${value}" (expected ${IMAGE_VARIANT_FORMATS.join(", ")})`,
	}
}

function invalidFit(value: string): ImageVariantParseResult {
	return {
		kind: "invalid",
		reason: `invalid fit "${value}" (expected ${IMAGE_VARIANT_FITS.join(", ")})`,
	}
}

function invalidArea(value: unknown): ImageVariantParseResult {
	return {
		kind: "invalid",
		reason: `area must be an integer between 1 and ${IMAGE_VARIANT_MAX_AREA} (got "${String(value)}")`,
	}
}

function invalidQuality(value: unknown): ImageVariantParseResult {
	return {
		kind: "invalid",
		reason: `quality must be an integer between ${IMAGE_VARIANT_MIN_QUALITY} and ${IMAGE_VARIANT_MAX_QUALITY} (got "${String(value)}")`,
	}
}

function parseVariantInteger(
	value: string | number,
	max: number,
): number | undefined {
	const num = typeof value === "number" ? value : Number(value)
	if (!Number.isInteger(num)) return undefined
	if (num < 1 || num > max) return undefined
	return num
}

/**
 * Fill the request defaults and clamp out-of-range values. `quality` is
 * the single client knob; it maps onto both per-format pipeline
 * qualities, which default to the caller's constants when omitted.
 */
export function normalizeImageVariantSpec(
	spec: ImageVariantSpec,
	qualityDefaults: {
		readonly avifQuality: number
		readonly webpQuality: number
	},
): ResolvedImageVariant {
	return {
		format: spec.format ?? "avif",
		fit: spec.fit ?? "inside",
		maxArea: clampArea(spec.maxArea ?? RESOURCE_PREVIEW_MAX_AREA),
		avifQuality: clampQuality(spec.quality ?? qualityDefaults.avifQuality),
		webpQuality: clampQuality(spec.quality ?? qualityDefaults.webpQuality),
	}
}

function clampArea(value: number): number {
	return Math.min(Math.max(1, Math.round(value)), IMAGE_VARIANT_MAX_AREA)
}

function clampQuality(value: number): number {
	return Math.min(
		Math.max(IMAGE_VARIANT_MIN_QUALITY, Math.round(value)),
		IMAGE_VARIANT_MAX_QUALITY,
	)
}

/**
 * Stable string identity of a resolved variant — the cache key input.
 * Two requests produce the same identity iff they render identically.
 */
export function imageVariantCanonical(variant: ResolvedImageVariant): string {
	return [
		variant.format,
		variant.fit,
		variant.maxArea,
		variant.webpQuality,
		variant.avifQuality,
	].join(":")
}

/**
 * Encode a variant request as the file route's query string. Always
 * carries `size=preview` so an older server that does not know the
 * variant parameters still degrades to its default preview instead of
 * serving the original bytes.
 */
export function imageVariantQuery(spec: ImageVariantSpec): string {
	const params: string[] = ["size=preview"]
	if (spec.format !== undefined) params.push(`fmt=${spec.format}`)
	if (spec.fit !== undefined) params.push(`fit=${spec.fit}`)
	if (spec.maxArea !== undefined) params.push(`area=${spec.maxArea}`)
	if (spec.quality !== undefined) params.push(`q=${spec.quality}`)
	return params.join("&")
}
