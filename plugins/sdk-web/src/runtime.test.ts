// @vitest-environment node
import { describe, expect, test } from "vitest"
import { createWebPluginAPI } from "./fixtures.ts"
import { buildFileUrl, buildFrameUrl, resolveFilesBaseUrl } from "./urls.ts"

const RES_ID = "res_1"
const TOKEN = "tok-abc"

describe("createWebPluginAPI stub", () => {
	test("uploadCover resolves a cover path by default", async () => {
		const api = createWebPluginAPI()
		await expect(
			api.uploadCover({ file: new ArrayBuffer(2), filename: "cover.png" }),
		).resolves.toEqual({ path: "/api/resources/r-test/cover" })
	})

	test("uploadCover can be overridden", async () => {
		const api = createWebPluginAPI({
			uploadCover: async () => ({ path: "/custom/cover" }),
		})
		await expect(
			api.uploadCover({ file: new Blob(), filename: "a.png" }),
		).resolves.toEqual({ path: "/custom/cover" })
	})
})

describe("resolveFilesBaseUrl", () => {
	test("tokenized files root with trailing slash", () => {
		expect(resolveFilesBaseUrl(RES_ID, TOKEN)).toBe(
			"/api/resources/res_1/files/tok-abc/",
		)
	})
})

describe("buildFileUrl", () => {
	test("no variant addresses the original bytes", () => {
		expect(buildFileUrl(RES_ID, "a.png", TOKEN)).toBe(
			"/api/resources/res_1/files/tok-abc/a.png",
		)
	})

	test("original alias emits no query", () => {
		expect(buildFileUrl(RES_ID, "a.png", TOKEN, "original")).toBe(
			"/api/resources/res_1/files/tok-abc/a.png",
		)
	})

	test("preview alias emits the compatibility query", () => {
		expect(buildFileUrl(RES_ID, "a.png", TOKEN, "preview")).toBe(
			"/api/resources/res_1/files/tok-abc/a.png?size=preview",
		)
	})

	test("a custom spec emits size=preview plus the variant parameters", () => {
		expect(
			buildFileUrl(RES_ID, "a.png", TOKEN, {
				format: "webp",
				fit: "exact",
				quality: 80,
			}),
		).toBe(
			"/api/resources/res_1/files/tok-abc/a.png?size=preview&fmt=webp&fit=exact&q=80",
		)
	})

	test("filenames and tokens are encoded (resIds are server-generated, not encoded)", () => {
		expect(buildFileUrl(RES_ID, "dir/page.png", "t/ok", "preview")).toBe(
			"/api/resources/res_1/files/t%2Fok/dir%2Fpage.png?size=preview",
		)
	})
})

describe("buildFrameUrl", () => {
	test("time is clamped and rounded into the path", () => {
		expect(buildFrameUrl(RES_ID, "clip.mp4", -5, TOKEN)).toBe(
			"/api/resources/res_1/frame/tok-abc/clip.mp4/0",
		)
		expect(buildFrameUrl(RES_ID, "clip.mp4", 1250.6, TOKEN)).toBe(
			"/api/resources/res_1/frame/tok-abc/clip.mp4/1251",
		)
	})
})
