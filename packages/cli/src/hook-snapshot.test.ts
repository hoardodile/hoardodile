import { describe, expect, test } from "vitest"
import {
	coverKindFromSniff,
	coverProbeInfo,
	snapshotDetect,
} from "./hook-snapshot.ts"

describe("snapshotDetect", () => {
	test("strips the payload from a successful match", () => {
		const detection = { ok: true, kind: "archive", filename: "book.cbz" }
		expect(snapshotDetect(detection)).toEqual({ ok: true })
	})

	test("keeps the miss reasons", () => {
		expect(snapshotDetect({ ok: false, reasons: ["page-image"] })).toEqual({
			ok: false,
			reasons: ["page-image"],
		})
	})

	test("normalizes a reasons-less miss", () => {
		expect(snapshotDetect({ ok: false })).toEqual({
			ok: false,
			reasons: undefined,
		})
	})
})

describe("coverProbeInfo", () => {
	test("carries an image cover's dimensions", () => {
		expect(
			coverProbeInfo({
				kind: "image",
				mime: "image/png",
				animated: false,
				width: 1600,
				height: 900,
			}),
		).toEqual({ kind: "image", width: 1600, height: 900 })
	})

	test("carries a video cover's dimensions", () => {
		expect(
			coverProbeInfo({
				kind: "video",
				mime: "video/mp4",
				width: 1920,
				height: 1080,
			}),
		).toEqual({ kind: "video", width: 1920, height: 1080 })
	})

	test("reads audio artwork dimensions", () => {
		expect(
			coverProbeInfo({
				kind: "audio",
				mime: "audio/mpeg",
				coverArt: { width: 600, height: 600 },
			}),
		).toEqual({ kind: "audio", width: 600, height: 600 })
	})

	test("keeps the kind alone when the box is missing or unusable", () => {
		expect(coverProbeInfo({ kind: "audio", mime: "audio/mpeg" })).toEqual({
			kind: "audio",
		})
		expect(
			coverProbeInfo({ kind: "image", mime: "image/png", animated: false }),
		).toEqual({ kind: "image" })
		expect(
			coverProbeInfo({
				kind: "image",
				mime: "image/png",
				animated: false,
				width: 0,
				height: 900,
			}),
		).toEqual({ kind: "image" })
	})

	test("ignores covers that are not decodable media", () => {
		expect(
			coverProbeInfo({ kind: "other", mime: "text/plain" }),
		).toBeUndefined()
		expect(
			coverProbeInfo({ kind: "unknown", reason: "failed" }),
		).toBeUndefined()
	})
})

describe("coverKindFromSniff", () => {
	test("keeps the kind of a cover the probe could not classify", () => {
		expect(coverKindFromSniff("video")).toEqual({ kind: "video" })
		expect(coverKindFromSniff("image")).toEqual({ kind: "image" })
	})

	test("drops kinds that are not cover families", () => {
		expect(coverKindFromSniff(undefined)).toBeUndefined()
		expect(coverKindFromSniff("animation")).toBeUndefined()
		expect(coverKindFromSniff("other")).toBeUndefined()
	})
})
