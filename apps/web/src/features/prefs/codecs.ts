export type { Codec } from "@hoardodile/sdk-web"
export {
	booleanCodec,
	jsonCodec,
	numberCodec,
} from "@hoardodile/sdk-web"

import type { Codec } from "@hoardodile/sdk-web"

/**
 * Codec for storing an ordered list of font names.
 *
 * - empty string → []
 * - JSON array → parsed as-is
 */
export const fontArrayCodec: Codec<readonly string[]> = {
	encode(value) {
		return JSON.stringify(value)
	},
	decode(raw) {
		if (raw === undefined || raw === "") return undefined
		try {
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				return parsed.filter((item) => typeof item === "string")
			}
		} catch {
			// malformed JSON
		}
		return undefined
	},
} as const

/**
 * Plain-string codec for preferences that are naturally simple strings
 * (e.g. language, theme mode, theme palette).
 *
 * Encodes and decodes verbatim. Empty or missing values decode to
 * `undefined`.
 */
export const plainStringCodec: Codec<string> = {
	encode(value) {
		return value
	},
	decode(raw) {
		if (raw === undefined || raw === "") return undefined
		return raw
	},
} as const
