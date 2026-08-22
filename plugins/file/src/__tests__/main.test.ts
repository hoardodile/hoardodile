import { createResourceAPIFixture } from "@hoardodile/sdk-server"
import { describe, expect, it } from "vitest"
import plugin from "../main"
import type { FileSchema } from "../shared"

describe("plugin-file main", () => {
	it("exports a plugin definition", () => {
		expect(plugin.detect).toBeDefined()
		expect(plugin.sourceMeta).toBeDefined()
		expect(plugin.listFiles).toBeDefined()
	})

	it("listFiles keeps the canonical container order with ext and size", async () => {
		const files = ["10.zip", "2.PDF", "readme", "01.txt"]
		const fixture = createResourceAPIFixture<FileSchema>({
			files,
			stats: { "10.zip": { sizeBytes: 500 }, "": { sizeBytes: 42 } },
		})
		const result = await plugin.listFiles?.(fixture.api)
		// `listFileNames` already returns the host's canonical order
		// (`.order` upload order, natural sort otherwise) — the tree must
		// not re-sort it.
		expect(result?.map((f) => f.filename)).toEqual(files)
		const byName = new Map(result?.map((f) => [f.filename, f]))
		expect(byName.get("10.zip")).toEqual({
			filename: "10.zip",
			ext: ".zip",
			sizeBytes: 500,
		})
		expect(byName.get("2.PDF")).toEqual({
			filename: "2.PDF",
			ext: ".pdf",
			sizeBytes: 42,
		})
		expect(byName.get("readme")).toEqual({
			filename: "readme",
			ext: undefined,
			sizeBytes: 42,
		})
	})
})
