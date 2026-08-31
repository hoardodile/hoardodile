import { describe, expect, it } from "vitest"
import type { HookSnapshot, WorkbenchManifest } from "./context.ts"
import {
	buildResCardAssetUrl,
	pickCardSlotUi,
	readSourceMetaDims,
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

	it("returns undefined for an un-declared cover kind", () => {
		expect(pickCardSlotUi(manifest, "audio")).toBeUndefined()
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

describe("readSourceMetaDims", () => {
	it("reads finite positive width/height from sourceMeta", () => {
		expect(readSourceMetaDims(snapshot({ width: 800, height: 600 }))).toEqual({
			width: 800,
			height: 600,
		})
	})

	it("returns undefined without a snapshot or dims", () => {
		expect(readSourceMetaDims(null)).toBeUndefined()
		expect(readSourceMetaDims(snapshot(undefined))).toBeUndefined()
	})

	it("drops missing, non-finite or non-positive dims", () => {
		expect(
			readSourceMetaDims(snapshot({ width: 0, height: 600 })),
		).toBeUndefined()
		expect(
			readSourceMetaDims(snapshot({ width: Number.NaN, height: 600 })),
		).toBeUndefined()
		expect(readSourceMetaDims(snapshot({ height: 600 }))).toBeUndefined()
	})
})
