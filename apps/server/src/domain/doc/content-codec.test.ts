import { describe, expect, test } from "vitest"
import { decodeContent, encodeContent } from "./repo.ts"

describe("content-codec", () => {
	test("encode-decode round-trip preserves a non-trivial document", () => {
		const doc = {
			version: 2,
			blocks: [
				{ type: "paragraph", content: [{ type: "text", text: "hello" }] },
			],
		}
		const decoded = decodeContent(encodeContent(doc))
		expect(decoded).toEqual(doc)
	})

	test("decodeContent returns an empty BlockNote shape for missing input", () => {
		expect(decodeContent(undefined)).toEqual({ version: 2, blocks: [] })
		expect(decodeContent(null)).toEqual({ version: 2, blocks: [] })
	})

	test("decodeContent returns an empty BlockNote shape for an empty buffer", () => {
		expect(decodeContent(Buffer.alloc(0))).toEqual({ version: 2, blocks: [] })
	})

	test("decodeContent returns the empty shape for corrupt input instead of throwing", () => {
		const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])
		expect(() => decodeContent(garbage)).not.toThrow()
		expect(decodeContent(garbage)).toEqual({ version: 2, blocks: [] })
	})

	test("each call returns a fresh object so callers can mutate independently", () => {
		const first = decodeContent(undefined)
		const second = decodeContent(undefined)
		expect(first).not.toBe(second)
		;(first.blocks as unknown[]).push({ type: "paragraph" })
		expect((second.blocks as unknown[]).length).toBe(0)
	})

	test("encodeContent falls back to an empty doc for nullish input", () => {
		const decoded = decodeContent(encodeContent(undefined))
		expect(decoded).toEqual({ version: 2, blocks: [] })
	})
})
