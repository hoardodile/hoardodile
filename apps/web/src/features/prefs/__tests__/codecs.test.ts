/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import {
	booleanCodec,
	jsonCodec,
	numberCodec,
	plainStringCodec,
} from "../codecs"

describe("jsonCodec", () => {
	test("round-trips primitives and plain objects", () => {
		const codec = jsonCodec<{
			readonly a: number
			readonly b: readonly string[]
		}>()
		const payload = { a: 1, b: ["x", "y"] } as const
		const raw = codec.encode(payload)
		expect(codec.decode(raw)).toEqual(payload)
	})

	test("returns undefined on parse failure", () => {
		const codec = jsonCodec<unknown>()
		expect(codec.decode("not-json")).toBeUndefined()
		expect(codec.decode("")).toBeUndefined()
	})
})

describe("numberCodec", () => {
	test("encodes and decodes finite numbers", () => {
		const codec = numberCodec()
		expect(codec.encode(42)).toBe("42")
		expect(codec.decode("42")).toBe(42)
		expect(codec.decode("-3.14")).toBe(-3.14)
	})

	test("returns undefined for non-finite parses", () => {
		const codec = numberCodec()
		expect(codec.decode("abc")).toBeUndefined()
		expect(codec.decode("Infinity")).toBeUndefined()
		expect(codec.decode("NaN")).toBeUndefined()
	})

	test('returns 0 for empty string (Number("") === 0)', () => {
		// Documented quirk of the codec: empty string parses as 0, not
		// undefined. Callers needing strict empty-handling should branch
		// on raw value before decoding.
		const codec = numberCodec()
		expect(codec.decode("")).toBe(0)
	})
})

describe("booleanCodec", () => {
	test("encodes booleans as 1/0", () => {
		const codec = booleanCodec()
		expect(codec.encode(true)).toBe("1")
		expect(codec.encode(false)).toBe("0")
	})

	test("accepts both 1/0 and true/false on decode", () => {
		const codec = booleanCodec()
		expect(codec.decode("1")).toBe(true)
		expect(codec.decode("true")).toBe(true)
		expect(codec.decode("0")).toBe(false)
		expect(codec.decode("false")).toBe(false)
	})

	test("returns undefined for unknown payloads", () => {
		const codec = booleanCodec()
		expect(codec.decode("")).toBeUndefined()
		expect(codec.decode("yes")).toBeUndefined()
		expect(codec.decode("2")).toBeUndefined()
	})
})

describe("plainStringCodec", () => {
	test("round-trips plain strings verbatim", () => {
		expect(plainStringCodec.encode("zh")).toBe("zh")
		expect(plainStringCodec.decode("zh")).toBe("zh")
		expect(plainStringCodec.decode("dark")).toBe("dark")
	})

	test("returns undefined for empty/undefined input", () => {
		expect(plainStringCodec.decode("")).toBeUndefined()
		expect(
			plainStringCodec.decode(undefined as unknown as string),
		).toBeUndefined()
	})
})
