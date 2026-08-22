/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { readBlockAlign, readHeadingLevel } from "./EditorStaticToolbar"

describe("readHeadingLevel", () => {
	it("returns the level for a heading block", () => {
		expect(readHeadingLevel({ type: "heading", props: { level: 2 } })).toBe(2)
	})

	it("returns undefined for non-heading blocks", () => {
		expect(readHeadingLevel({ type: "paragraph", props: { level: 1 } })).toBe(
			undefined,
		)
	})

	it("returns undefined for unsupported levels", () => {
		expect(readHeadingLevel({ type: "heading", props: { level: 7 } })).toBe(
			undefined,
		)
	})

	it("returns undefined when props are missing or malformed", () => {
		expect(readHeadingLevel({ type: "heading" })).toBe(undefined)
		expect(readHeadingLevel({ type: "heading", props: undefined })).toBe(
			undefined,
		)
	})
})

describe("readBlockAlign", () => {
	it("returns the alignment when set to a known value", () => {
		expect(readBlockAlign({ props: { textAlignment: "center" } })).toBe(
			"center",
		)
	})

	it("returns undefined when alignment is unknown or missing", () => {
		expect(readBlockAlign({ props: { textAlignment: "justify" } })).toBe(
			undefined,
		)
		expect(readBlockAlign({ props: {} })).toBe(undefined)
		expect(readBlockAlign({})).toBe(undefined)
	})
})
