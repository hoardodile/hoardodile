import type { Codec } from "./types.ts"

/**
 * JSON codec covering the common case (`number`, `string`, `boolean`, plain
 * objects). Falls back to `undefined` on parse errors so callers see "missing"
 * instead of a corrupted value.
 */
export function jsonCodec<T>(): Codec<T> {
	return {
		encode(value) {
			return JSON.stringify(value)
		},
		decode(raw) {
			try {
				return JSON.parse(raw) as T
			} catch {
				return undefined
			}
		},
	}
}

/**
 * Plain-string number codec. Avoids the `""` → `0` ambiguity of
 * {@link jsonCodec} by treating any non-finite parse as missing.
 */
export function numberCodec(fallback?: number): Codec<number> {
	return {
		encode(value) {
			return String(value)
		},
		decode(raw) {
			const n = Number(raw)
			return Number.isFinite(n) ? n : fallback
		},
	}
}

/**
 * Boolean codec using `"1"`/`"0"` for compact storage. Also accepts
 * `"true"`/`"false"` for interoperability.
 */
export function booleanCodec(): Codec<boolean> {
	return {
		encode(value) {
			return value ? "1" : "0"
		},
		decode(raw) {
			if (raw === "1" || raw === "true") return true
			if (raw === "0" || raw === "false") return false
			return undefined
		},
	}
}
