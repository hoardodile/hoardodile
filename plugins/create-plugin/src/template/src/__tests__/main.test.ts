import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDirectoryResourceAPI } from "@hoardodile/host"
import { createResourceAPIFixture } from "@hoardodile/sdk-server"
import plugin from "../main"
import type { TemplateSchema } from "../shared"

describe("template plugin", () => {
	it("detects resources containing a .hdtpl file, carrying the classification", async () => {
		const { api } = createResourceAPIFixture<TemplateSchema>({
			files: ["notes.hdtpl"],
		})
		const result = await plugin.detect(api)
		expect(result).toEqual({ ok: true, hdtplCount: 1 })
	})

	it("misses resources without .hdtpl files", async () => {
		const { api } = createResourceAPIFixture<TemplateSchema>({
			files: ["photo.jpg"],
		})
		const result = await plugin.detect(api)
		expect(result.ok).toBe(false)
	})

	it("lists only .hdtpl files in sourceMeta", async () => {
		const { api } = createResourceAPIFixture<TemplateSchema>({
			files: ["a.hdtpl", "photo.jpg", "b.hdtpl"],
		})
		const meta = await plugin.sourceMeta?.(api)
		expect(meta).toEqual({ files: ["a.hdtpl", "b.hdtpl"], hdtplCount: 2 })
	})

	it("sourceMeta reuses the detect payload via api.context", async () => {
		const { api } = createResourceAPIFixture<TemplateSchema>({
			files: ["a.hdtpl", "b.hdtpl"],
			context: { detect: { hdtplCount: 2 } },
		})
		const meta = await plugin.sourceMeta?.(api)
		expect(meta).toEqual({ files: ["a.hdtpl", "b.hdtpl"], hdtplCount: 2 })
	})
})

// Layer 2 (see "Testing" in the plugin development docs): run the hooks
// against real files on disk. `createDirectoryResourceAPI` has import-time
// semantics — probes return undefined, so probe-dependent hooks need layer 3.
describe("against real files", () => {
	let dir: string

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	it("detects a directory containing a .hdtpl file", async () => {
		dir = mkdtempSync(join(tmpdir(), "hdtpl-test-"))
		writeFileSync(join(dir, "notes.hdtpl"), "template contents")
		writeFileSync(join(dir, "photo.jpg"), "not a template")
		const api = createDirectoryResourceAPI<TemplateSchema>(dir)
		const result = await plugin.detect(api)
		expect(result).toEqual({ ok: true, hdtplCount: 1 })
		const meta = await plugin.sourceMeta?.(api)
		expect(meta).toEqual({ files: ["notes.hdtpl"], hdtplCount: 1 })
	})
})
