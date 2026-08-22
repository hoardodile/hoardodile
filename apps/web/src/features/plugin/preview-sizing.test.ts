/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { resolvePreviewSizing } from "./preview-sizing"

const OPTS = { maxHeight: "70vh", fallbackHeight: "60vh" }

describe("resolvePreviewSizing", () => {
	test("aspect ratio wins and is capped by maxHeight", () => {
		expect(resolvePreviewSizing({ aspect: "16/9" }, OPTS)).toEqual({
			aspectRatio: "16/9",
			maxHeight: "70vh",
		})
	})

	test("aspect takes precedence over a declared height", () => {
		expect(
			resolvePreviewSizing({ aspect: "16/9", height: "400px" }, OPTS),
		).toEqual({ aspectRatio: "16/9", maxHeight: "70vh" })
	})

	test("fixed height applies when no aspect is declared", () => {
		expect(resolvePreviewSizing({ height: "400px" }, OPTS)).toEqual({
			height: "400px",
			maxHeight: "400px",
		})
	})

	test("falls back to the host default when nothing is declared", () => {
		expect(resolvePreviewSizing({}, OPTS)).toEqual({
			height: "60vh",
			maxHeight: "60vh",
		})
	})

	test("falls back when the manifest ui block is missing", () => {
		expect(resolvePreviewSizing(undefined, OPTS)).toEqual({
			height: "60vh",
			maxHeight: "60vh",
		})
	})
})
