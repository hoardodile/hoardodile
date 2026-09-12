import { describe, expect, it } from "vitest"
import type { HookSnapshot, WorkbenchManifest } from "./context.ts"
import {
	buildMockCardMeta,
	buildResCardAssetUrl,
	cardWidth,
	fitCoverBox,
	formatMockDate,
	pickCardSlotUi,
	readCoverDims,
	resolveCoverKind,
} from "./res-card-preview.ts"

function snapshot(
	sourceMeta: unknown,
	coverKind?: string,
	searchMeta?: unknown,
): HookSnapshot {
	return {
		detect: { ok: true },
		sourceMeta,
		searchMeta,
		files: undefined,
		fileStats: {},
		errors: {},
		...(coverKind !== undefined ? { coverKind } : {}),
	}
}

describe("resolveCoverKind", () => {
	it("falls back to default when there is no cover kind", () => {
		expect(resolveCoverKind(null)).toBe("default")
		expect(resolveCoverKind(snapshot(undefined))).toBe("default")
		expect(resolveCoverKind(snapshot({ coverKind: "" }))).toBe("default")
		expect(resolveCoverKind(snapshot({ coverKind: 42 }))).toBe("default")
	})

	it("prefers the sniffed snapshot coverKind", () => {
		expect(resolveCoverKind(snapshot({ coverKind: "audio" }, "image"))).toBe(
			"image",
		)
		expect(resolveCoverKind(snapshot(undefined, "video"))).toBe("video")
	})

	it("reads a plugin-declared coverKind from sourceMeta", () => {
		expect(resolveCoverKind(snapshot({ coverKind: "video" }))).toBe("video")
	})

	it("ignores a non-cover snapshot kind (e.g. animation)", () => {
		expect(resolveCoverKind(snapshot(undefined, "animation"))).toBe("default")
	})
})

describe("pickCardSlotUi", () => {
	const manifest: WorkbenchManifest = {
		id: "p",
		name: "P",
		ui: {
			card: {
				default: { bl: ["{{bytes(file.sizeBytes)}}"] },
				video: { tl: ["{{icon('Play')}}"] },
			},
		},
	}

	it("returns the block for the given cover kind", () => {
		expect(pickCardSlotUi(manifest, "video")?.tl).toEqual(["{{icon('Play')}}"])
	})

	it("returns the default block for the default kind", () => {
		expect(pickCardSlotUi(manifest, "default")?.bl).toEqual([
			"{{bytes(file.sizeBytes)}}",
		])
	})

	it("falls back to the default block for an un-declared cover kind", () => {
		expect(pickCardSlotUi(manifest, "audio")?.bl).toEqual([
			"{{bytes(file.sizeBytes)}}",
		])
	})

	it("returns undefined when the manifest declares no card block", () => {
		expect(pickCardSlotUi({ id: "p", name: "P" }, "default")).toBeUndefined()
	})
})

describe("buildResCardAssetUrl", () => {
	it("maps to the /data mount scoped to the resource", () => {
		expect(buildResCardAssetUrl("res-1", "icons/heart.gif")).toBe(
			"/data/icons/heart.gif?res=res-1",
		)
	})

	it("URL-encodes the resource id and each path segment", () => {
		expect(buildResCardAssetUrl("a b", "ic ons/x.svg")).toBe(
			"/data/ic%20ons/x.svg?res=a%20b",
		)
	})
})

describe("readCoverDims", () => {
	it("reads the probed cover dimensions", () => {
		expect(
			readCoverDims({
				...snapshot(undefined),
				coverWidth: 1600,
				coverHeight: 900,
			}),
		).toEqual({ width: 1600, height: 900 })
	})

	it("returns undefined without a snapshot, a probe box or a usable pair", () => {
		expect(readCoverDims(null)).toBeUndefined()
		expect(readCoverDims(snapshot(undefined))).toBeUndefined()
		expect(
			readCoverDims({
				...snapshot(undefined),
				coverWidth: 0,
				coverHeight: 900,
			}),
		).toBeUndefined()
		expect(
			readCoverDims({
				...snapshot(undefined),
				coverWidth: Number.NaN,
				coverHeight: 900,
			}),
		).toBeUndefined()
		expect(
			readCoverDims({ ...snapshot(undefined), coverHeight: 900 }),
		).toBeUndefined()
	})

	it("ignores plugin-declared sourceMeta dimensions", () => {
		// The card reads the cover probe, not the resource's own media
		// metadata — a video resource's source dims must not size a cover.
		expect(
			readCoverDims(snapshot({ width: 1920, height: 1080 })),
		).toBeUndefined()
	})
})

describe("fitCoverBox", () => {
	it("scales a large cover down into the card window, aspect kept", () => {
		expect(fitCoverBox({ width: 1600, height: 900 })).toEqual({
			width: 400,
			height: 225,
		})
		expect(fitCoverBox({ width: 600, height: 1200 })).toEqual({
			width: 300,
			height: 600,
		})
	})

	it("never scales a small cover up", () => {
		expect(fitCoverBox({ width: 320, height: 200 })).toEqual({
			width: 320,
			height: 200,
		})
	})

	it("falls back to the compact square without a probe box", () => {
		expect(fitCoverBox(undefined)).toEqual({ width: 200, height: 200 })
	})

	it("keeps an ultra-wide cover inside the height clamp", () => {
		expect(fitCoverBox({ width: 4000, height: 1000 })).toEqual({
			width: 400,
			height: 100,
		})
	})
})

describe("cardWidth", () => {
	it("follows the cover box", () => {
		expect(cardWidth({ width: 320, height: 200 })).toBe(320)
	})

	it("floors a tiny cover at the compact width", () => {
		expect(cardWidth({ width: 80, height: 80 })).toBe(200)
	})
})

describe("buildMockCardMeta", () => {
	it("returns plausible fabricated metadata", () => {
		const meta = buildMockCardMeta()
		expect(meta.tags.length).toBeGreaterThan(0)
		expect(meta.tags[0]).toHaveProperty("name")
		expect(meta.tags[0]).toHaveProperty("color")
		expect(meta.collections.length).toBeGreaterThan(0)
		expect(meta.sourceUrl).toMatch(/^https?:\/\//)
		expect(meta.sizeBytes).toBeGreaterThan(0)
		expect(meta.createdAt).toBeLessThan(Date.now())
	})
})

describe("formatMockDate", () => {
	it("formats a timestamp as a locale string carrying the year", () => {
		const ts = Date.UTC(2025, 8, 5, 14, 30)
		expect(formatMockDate(ts, "en-US")).toContain("2025")
		expect(formatMockDate(ts, "zh-CN")).toContain("2025")
	})
})
