import type { PluginManifest } from "@hoardodile/sdk-types"
import { describe, expect, test } from "vitest"
import {
	lintManifestTemplates,
	lintTemplate,
	manifestTemplates,
} from "./template-lint.ts"

describe("lintTemplate", () => {
	test("accepts the documented template surface", () => {
		const templates = [
			"{{data.field}}",
			"{{if(gt(file.count, 1), join(' ', file.count, t('chapterCountLabel')))}}",
			"{{join(' ', source.width, 'x', source.height)}}",
			"{{duration(ms)}}",
			"{{icon('Image')}}",
			"{{asset('path')}}",
			"{{kind('image')}}",
			"{{searchKindIcons()}}",
			"{{inc(data.page)}}",
			"{{eq(a, b)}}",
			"{{bytes(size)}}",
			"plain text without expressions",
		]
		for (const template of templates) {
			expect(lintTemplate(template, new Set(["chapterCountLabel"]))).toEqual([])
		}
	})

	test("flags unknown function names", () => {
		const issues = lintTemplate("{{frobnicate(file.count)}}", new Set())
		expect(issues[0]?.message).toMatch(/unknown function "frobnicate"/)
	})

	test("flags unknown functions nested inside other calls", () => {
		const issues = lintTemplate(
			"{{if(gt(file.count, 1), frobnicate(file.count))}}",
			new Set(),
		)
		expect(issues[0]?.message).toMatch(/unknown function "frobnicate"/)
	})

	test("flags unbalanced braces", () => {
		const issues = lintTemplate("{{data.field", new Set())
		expect(issues[0]?.message).toMatch(/unbalanced/)
	})

	test("flags unbalanced parentheses inside an expression", () => {
		const issues = lintTemplate("{{if(gt(file.count, 1)}}", new Set())
		expect(issues[0]?.message).toMatch(/unbalanced parentheses/)
	})

	test("flags unparseable expressions", () => {
		const issues = lintTemplate("{{(call)}}", new Set())
		expect(issues[0]?.message).toMatch(/cannot parse/)
	})

	test("flags missing i18n keys referenced via t()", () => {
		const issues = lintTemplate("{{t('missingLabel')}}", new Set(["present"]))
		expect(issues[0]?.message).toMatch(/missingLabel/)
	})

	test("flags missing i18n keys referenced from nested calls", () => {
		const issues = lintTemplate(
			"{{if(gt(file.count, 1), join(' ', t('missingLabel')))}}",
			new Set(["present"]),
		)
		expect(issues[0]?.message).toMatch(/missingLabel/)
	})

	test("accepts i18n keys the manifest declares", () => {
		expect(lintTemplate("{{t('present')}}", new Set(["present"]))).toEqual([])
	})
})

describe("manifestTemplates", () => {
	test("collects card corners, search kinds and message anchors", () => {
		const manifest = {
			id: "00000000-0000-4000-8000-000000000000",
			name: "x",
			description: "x",
			version: "0.0.0",
			permissions: {
				sourceMeta: false,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
				container: false,
			},
			ui: {
				card: {
					image: {
						bl: ["{{file.count}}"],
						br: ["{{source.width}}"],
					},
				},
				search: {
					kinds: [
						{
							key: "image",
							label: "{{t('label')}}",
							icon: "{{icon('Image')}}",
						},
					],
				},
				message: { anchor: "{{inc(data.page)}}" },
			},
		} satisfies PluginManifest
		expect(manifestTemplates(manifest)).toEqual([
			"{{file.count}}",
			"{{source.width}}",
			"{{t('label')}}",
			"{{icon('Image')}}",
			"{{inc(data.page)}}",
		])
	})
})

describe("lintManifestTemplates", () => {
	test("warns on i18n keys the manifest never declares", () => {
		const manifest = {
			id: "00000000-0000-4000-8000-000000000000",
			name: "x",
			description: "x",
			version: "0.0.0",
			permissions: {
				sourceMeta: false,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
				container: false,
			},
			i18n: { en: { present: "Present" } },
			ui: {
				message: { anchor: "{{t('missing')}}" },
			},
		} satisfies PluginManifest
		const { issues } = lintManifestTemplates(manifest)
		expect(issues[0]?.message).toMatch(/missing/)
	})
})
