// @vitest-environment node
import { pluginMethods } from "@hoardodile/sdk-web"
import { describe, expect, test } from "vitest"
import { requestSchemas } from "./request-schemas.ts"

const schema = requestSchemas[pluginMethods.uploadCover]
if (schema === undefined) throw new Error("uploadCover schema is missing")

describe("uploadCover request schema", () => {
	test("accepts an ArrayBuffer payload", () => {
		const parsed = schema.safeParse({
			file: new ArrayBuffer(4),
			filename: "cover.png",
		})
		expect(parsed.success).toBe(true)
	})

	test("accepts a Blob payload", () => {
		const parsed = schema.safeParse({
			file: new Blob([new Uint8Array([1, 2, 3])]),
			filename: "cover.webp",
		})
		expect(parsed.success).toBe(true)
	})

	test("accepts an optional mimeType", () => {
		const parsed = schema.safeParse({
			file: new ArrayBuffer(2),
			filename: "a.jpeg",
			mimeType: "image/jpeg",
		})
		expect(parsed.success).toBe(true)
	})

	test("rejects a file that is not a byte container", () => {
		const parsed = schema.safeParse({ file: {}, filename: "a.png" })
		expect(parsed.success).toBe(false)
	})

	test("rejects an empty or missing filename", () => {
		expect(
			schema.safeParse({ file: new ArrayBuffer(1), filename: "" }).success,
		).toBe(false)
		expect(schema.safeParse({ file: new ArrayBuffer(1) }).success).toBe(false)
	})

	test("rejects an oversized mimeType", () => {
		const parsed = schema.safeParse({
			file: new ArrayBuffer(1),
			filename: "a.png",
			mimeType: "x".repeat(256),
		})
		expect(parsed.success).toBe(false)
	})
})
