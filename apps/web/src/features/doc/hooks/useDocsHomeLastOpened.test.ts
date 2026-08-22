import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import { useDocsHomeLastOpened } from "./useDocsHomeLastOpened"

describe("useDocsHomeLastOpened", () => {
	it("records the documents home as the last-opened location", () => {
		prefSync.set(prefKeys.docLastOpened, "doc-123")

		renderHook(() => useDocsHomeLastOpened())

		expect(prefSync.get(prefKeys.docLastOpened)).toBe("")
	})

	it("stays on the home value when nothing was opened before", () => {
		renderHook(() => useDocsHomeLastOpened())

		expect(prefSync.get(prefKeys.docLastOpened) ?? "").toBe("")
	})
})
