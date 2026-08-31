// @vitest-environment node
import { describe, expect, it } from "vitest"
import { isResourceContentRequest, normalizeResourceCacheKey } from "./sw-cache"

const RES = "/api/resources/res-1"

describe("isResourceContentRequest", () => {
	const base = {
		sameOrigin: true,
		hasRange: false,
	}

	it("matches same-origin file/frame/extracted GETs (tokenized)", () => {
		for (const pathname of [
			`${RES}/files/TOK/a.png`,
			`${RES}/frame/TOK/clip.mp4/5000`,
			`${RES}/extracted/TOK/page.pdf`,
		]) {
			expect(
				isResourceContentRequest({ ...base, method: "GET", pathname }),
			).toBe(true)
		}
	})

	it("does NOT match resource covers (no files/frame/extracted segment)", () => {
		expect(
			isResourceContentRequest({
				...base,
				method: "GET",
				pathname: `${RES}/cover`,
			}),
		).toBe(false)
	})

	it("does NOT match non-GET methods", () => {
		for (const method of ["POST", "PUT", "DELETE"]) {
			expect(
				isResourceContentRequest({
					...base,
					method,
					pathname: `${RES}/files/TOK/a.png`,
				}),
			).toBe(false)
		}
	})

	it("does NOT match Range requests (byte-range streaming)", () => {
		expect(
			isResourceContentRequest({
				...base,
				method: "GET",
				pathname: `${RES}/files/TOK/a.mp4`,
				hasRange: true,
			}),
		).toBe(false)
	})

	it("does NOT match cross-origin requests", () => {
		expect(
			isResourceContentRequest({
				...base,
				method: "GET",
				pathname: `${RES}/files/TOK/a.png`,
				sameOrigin: false,
			}),
		).toBe(false)
	})

	it("does NOT match non-resource paths", () => {
		for (const pathname of [
			"/api/plugins/abc/index.html",
			"/api/plugins/abc/index.html?v=123",
			"/sw.js",
			"/site.webmanifest",
		]) {
			expect(
				isResourceContentRequest({ ...base, method: "GET", pathname }),
			).toBe(false)
		}
	})

	it("matches every content family on any resource id", () => {
		expect(
			isResourceContentRequest({
				...base,
				method: "GET",
				pathname: "/api/resources/another-id/files/tok/video.webm",
			}),
		).toBe(true)
	})
})

describe("normalizeResourceCacheKey", () => {
	it("strips the token from /files/<token>", () => {
		expect(normalizeResourceCacheKey(`${RES}/files/TOK/a.png`)).toBe(
			`${RES}/files/a.png`,
		)
	})

	it("strips the token from /frame/<token> (the video seek-frame family)", () => {
		expect(normalizeResourceCacheKey(`${RES}/frame/TOK/clip.mp4/5000`)).toBe(
			`${RES}/frame/clip.mp4/5000`,
		)
	})

	it("strips the token from /extracted/<token>", () => {
		expect(normalizeResourceCacheKey(`${RES}/extracted/TOK/page.pdf`)).toBe(
			`${RES}/extracted/page.pdf`,
		)
	})

	it("folds a trailing /files/<token>/ base to /files/", () => {
		expect(normalizeResourceCacheKey(`${RES}/files/TOK/`)).toBe(`${RES}/files/`)
	})

	it("keeps a token-less path unchanged", () => {
		expect(normalizeResourceCacheKey(`${RES}/files/a.png`)).toBe(
			`${RES}/files/a.png`,
		)
	})
})
