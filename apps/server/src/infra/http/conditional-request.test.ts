import { expect, test } from "vitest"
import {
	computeValidators,
	isNotModified,
	pickHeader,
	replyNotModified,
} from "./conditional-request.ts"

// --- computeValidators ---

test("computeValidators generates weak etag from size and mtimeMs", () => {
	const result = computeValidators({ size: 1024, mtimeMs: 1716374400000 })
	expect(result.etag).toBe('W/"400-18f9fe2ec00"')
})

test("computeValidators truncates sub-millisecond mtime", () => {
	const result = computeValidators({ size: 0, mtimeMs: 1716374400000.999 })
	expect(result.etag).toBe('W/"0-18f9fe2ec00"')
})

test("computeValidators returns lastModified as UTC string", () => {
	const result = computeValidators({ size: 0, mtimeMs: 1716374400000 })
	expect(result.lastModified).toBe("Wed, 22 May 2024 10:40:00 GMT")
})

// --- pickHeader ---

test("pickHeader returns string as-is", () => {
	expect(pickHeader("hello")).toBe("hello")
})

test("pickHeader returns first element of array", () => {
	expect(pickHeader(["a", "b"])).toBe("a")
})

test("pickHeader returns undefined for undefined", () => {
	expect(pickHeader(undefined)).toBeUndefined()
})

// --- isNotModified ---

test("isNotModified returns false when neither header is present", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	expect(isNotModified({}, validators)).toBe(false)
})

test("isNotModified returns true when If-None-Match matches etag", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	expect(isNotModified({ "if-none-match": validators.etag }, validators)).toBe(
		true,
	)
})

test("isNotModified returns true for wildcard If-None-Match", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	expect(isNotModified({ "if-none-match": "*" }, validators)).toBe(true)
})

test("isNotModified returns false when If-None-Match does not match", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	expect(isNotModified({ "if-none-match": 'W/"deadbeef"' }, validators)).toBe(
		false,
	)
})

test("isNotModified matches any tag in comma-separated If-None-Match", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	expect(
		isNotModified(
			{ "if-none-match": `"abc", ${validators.etag}, "xyz"` },
			validators,
		),
	).toBe(true)
})

test("isNotModified returns true when If-Modified-Since >= lastModified", () => {
	const validators = {
		etag: '"test"',
		lastModified: "Wed, 22 May 2024 10:40:00 GMT",
	}
	expect(
		isNotModified(
			{ "if-modified-since": "Wed, 22 May 2024 12:00:00 GMT" },
			validators,
		),
	).toBe(true)
})

test("isNotModified returns false when If-Modified-Since < lastModified", () => {
	const validators = {
		etag: '"test"',
		lastModified: "Wed, 22 May 2024 10:40:00 GMT",
	}
	expect(
		isNotModified(
			{ "if-modified-since": "Wed, 22 May 2024 09:00:00 GMT" },
			validators,
		),
	).toBe(false)
})

test("isNotModified handles If-None-Match as array", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	expect(
		isNotModified({ "if-none-match": [validators.etag] }, validators),
	).toBe(true)
})

// --- replyNotModified ---

test("replyNotModified sets etag and last-modified headers", () => {
	const headers: Record<string, string> = {}
	const reply = {
		header(name: string, value: string) {
			headers[name] = value
			return this
		},
		code(_c: number) {
			return this
		},
		send() {
			return this
		},
	}
	const result = replyNotModified(
		reply as any,
		{},
		{ size: 42, mtimeMs: 1716374400000 },
	)
	expect(result).toBe(false)
	expect(headers.etag).toBe('W/"2a-18f9fe2ec00"')
	expect(headers["last-modified"]).toBe("Wed, 22 May 2024 10:40:00 GMT")
})

test("replyNotModified returns true and sends 304 when not modified", () => {
	const validators = computeValidators({ size: 100, mtimeMs: 1000 })
	let statusCode = 0
	let bodySent = false
	const reply = {
		header(_name: string, _value: string) {
			return this
		},
		code(c: number) {
			statusCode = c
			return this
		},
		send() {
			bodySent = true
			return this
		},
	}
	const result = replyNotModified(
		reply as any,
		{ "if-none-match": validators.etag },
		{ size: 100, mtimeMs: 1000 },
	)
	expect(result).toBe(true)
	expect(statusCode).toBe(304)
	expect(bodySent).toBe(true)
})
