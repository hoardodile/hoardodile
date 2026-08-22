import { describe, expect, expectTypeOf, test } from "vitest"
import type { Detection, FileType } from "./plugin-definition.ts"
import { createResourceAPIFixture } from "./plugin-definition.ts"

const JPEG: FileType = {
	mime: "image/jpeg",
	ext: ".jpg",
	kind: "image",
	source: "magic",
}

const PNG: FileType = {
	mime: "image/png",
	ext: ".png",
	kind: "image",
	source: "magic",
}

describe("createResourceAPIFixture path matching", () => {
	test("an exact key beats the empty-key default", async () => {
		const { api } = createResourceAPIFixture({
			files: ["a.jpg", "b.png"],
			types: { "a.jpg": JPEG, "": PNG },
		})
		await expect(api.sniff("a.jpg")).resolves.toEqual(JPEG)
		await expect(api.sniff("b.png")).resolves.toEqual(PNG)
	})

	test("dot keys match any path by extension suffix", async () => {
		const { api } = createResourceAPIFixture({
			files: ["01.mp4", "02.mp3", "03.webp"],
			types: {
				".mp4": JPEG,
				"": PNG,
			},
		})
		await expect(api.sniff("01.mp4")).resolves.toEqual(JPEG)
		await expect(api.sniff("02.mp3")).resolves.toEqual(PNG)
	})

	test("the longest dot key wins over shorter fragments", async () => {
		const { api } = createResourceAPIFixture({
			files: ["a.webp"],
			types: {
				".webp": PNG,
				p: JPEG,
			},
		})
		// "p" does not start with a dot, so only ".webp" qualifies.
		await expect(api.sniff("a.webp")).resolves.toEqual(PNG)
	})

	test("plain-name keys never hijack paths that merely contain them", async () => {
		const { api } = createResourceAPIFixture({
			files: ["a.jpg", "ba.jpg"],
			types: { "a.jpg": JPEG, "": PNG },
		})
		// "ba.jpg" contains "a.jpg" — the plain-name key must keep it on
		// the default instead of hijacking the a.jpg config.
		await expect(api.sniff("ba.jpg")).resolves.toEqual(PNG)
	})

	test("probes follow the same rules", async () => {
		const { api } = createResourceAPIFixture({
			files: ["01.mp4", "02.mp3"],
			probes: {
				".mp4": { kind: "video", mime: "video/mp4", width: 640, height: 480 },
				"": { kind: "unknown", reason: "unavailable" },
			},
		})
		await expect(api.probe("01.mp4")).resolves.toMatchObject({ kind: "video" })
		await expect(api.probe("02.mp3")).resolves.toEqual({
			kind: "unknown",
			reason: "unavailable",
		})
	})

	test("stats prefer the exact key", async () => {
		const { api } = createResourceAPIFixture({
			files: ["a.jpg", "b.png"],
			stats: { "a.jpg": { sizeBytes: 10 }, "": { sizeBytes: 99 } },
		})
		await expect(api.statFile("a.jpg")).resolves.toEqual({ sizeBytes: 10 })
		await expect(api.statFile("b.png")).resolves.toEqual({ sizeBytes: 99 })
	})

	test("context config is exposed as api.context.detect", async () => {
		const { api } = createResourceAPIFixture({
			files: ["a.jpg"],
			context: { detect: { shape: "archive" } },
		})
		expect(api.context.detect).toEqual({ shape: "archive" })
	})

	test("context defaults to an absent detect payload", async () => {
		const { api } = createResourceAPIFixture({ files: ["a.jpg"] })
		expect(api.context.detect).toBeUndefined()
	})
})

describe("Detection type linkage", () => {
	type Shape = { readonly kind: "pages" | "archive" }

	test("a match carrying the declared shape satisfies the slot type", () => {
		expectTypeOf<{ ok: true; kind: "archive" }>().toMatchTypeOf<
			Detection<Shape>
		>()
	})

	test("a payload-less match no longer satisfies a declared shape", () => {
		expectTypeOf<{ ok: true }>().not.toMatchTypeOf<Detection<Shape>>()
	})

	test("the bare Detection stays payload-agnostic", () => {
		expectTypeOf<{ ok: true }>().toMatchTypeOf<Detection>()
	})
})
