/**
 * @vitest-environment node
 */
import { describe, expect, test } from "vitest"
import {
	assertCatalogMonolingual,
	catalogFacets,
	catalogMedia,
	chars,
	FILE_PLUGIN_ID,
	fileResources,
	resources,
	traits,
} from "./catalog.ts"
import { licenseFamilyOf } from "./download.ts"
import { mixesScripts } from "./lang.ts"

describe("demo seed catalog", () => {
	test("every user-visible string is monolingual", () => {
		expect(() => assertCatalogMonolingual()).not.toThrow()
	})

	test("covers every gallery search facet", () => {
		expect([...catalogFacets()].sort()).toEqual(
			["animation", "audio", "image", "video"].sort(),
		)
		const byFacet = new Set(Object.values(resources).map((row) => row.facet))
		expect(byFacet.has("image")).toBe(true)
		expect(byFacet.has("animation")).toBe(true)
		expect(byFacet.has("audio")).toBe(true)
		expect(byFacet.has("video")).toBe(true)
	})

	test("every media file declares a Commons title and license family", () => {
		const media = catalogMedia()
		expect(media.length).toBeGreaterThan(0)
		for (const item of media) {
			expect(item.title.startsWith("File:")).toBe(true)
			expect(item.expectedLicenseFamily).toBe("pd")
		}
	})

	test("declares a builtin File plugin resource", () => {
		expect(FILE_PLUGIN_ID).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
		expect(Object.keys(fileResources).length).toBeGreaterThan(0)
		for (const row of Object.values(fileResources)) {
			expect(row.files.length).toBeGreaterThan(0)
			for (const file of row.files) {
				expect(file.filename.endsWith(".txt")).toBe(true)
			}
		}
	})

	test("height and weight traits use dimensional kinds", () => {
		expect(traits.height.kind).toBe("height")
		expect(traits.weight.kind).toBe("weight")
	})

	test("at least one resource is a multi-file still album", () => {
		const albums = Object.values(resources).filter(
			(row) => row.facet === "image" && row.files.length > 1,
		)
		expect(albums.length).toBeGreaterThan(0)
	})

	test("is large enough for a finished-looking library", () => {
		expect(Object.keys(resources).length).toBeGreaterThanOrEqual(12)
		expect(Object.keys(chars).length).toBeGreaterThanOrEqual(8)
	})

	test("uses the animal parent-rule tags on resources", () => {
		const used = new Set(
			Object.values(resources).flatMap((row) => [...row.tagKeys]),
		)
		expect(used.has("animal")).toBe(true)
		expect(used.has("cat")).toBe(true)
	})
})

describe("license allowlist", () => {
	test("accepts public domain and CC0 / CC BY families", () => {
		expect(licenseFamilyOf("pd", "Public domain")).toBe("pd")
		expect(licenseFamilyOf("", "No restrictions")).toBe("pd")
		expect(licenseFamilyOf("cc0", "CC0")).toBe("cc0")
		expect(licenseFamilyOf("cc-by-4.0", "CC BY 4.0")).toBe("cc-by")
		expect(licenseFamilyOf("cc-by-sa-3.0", "CC BY-SA 3.0")).toBe("cc-by-sa")
	})

	test("rejects non-commercial and unlicensed files", () => {
		expect(licenseFamilyOf("cc-by-nc-4.0", "CC BY-NC 4.0")).toBeUndefined()
		expect(licenseFamilyOf("cc-by-nd-3.0", "CC BY-ND 3.0")).toBeUndefined()
		expect(licenseFamilyOf("", "")).toBeUndefined()
	})
})

describe("script mixing heuristic", () => {
	test("flags CJK mixed with Latin", () => {
		expect(mixesScripts("湖边 Sunset")).toBe(true)
		expect(mixesScripts("地球相册")).toBe(false)
		expect(mixesScripts("Nearby galaxies")).toBe(false)
	})
})
