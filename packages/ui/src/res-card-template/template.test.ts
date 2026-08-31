/**
 * @vitest-environment node
 */

import { createElement } from "react"
import { describe, expect, test } from "vitest"
import { type IconRef, normalizeSolarGlyphName } from "./icon.ts"
import {
	type RenderIcon,
	renderCardTemplate,
	renderSlotBadges,
	resolveLocaleString,
	type TemplateContext,
} from "./index.ts"

// A deterministic in-memory icon renderer: a fixed set of "known" Solar
// glyphs (what the app's renderer considers resolvable) draw a React
// element (so mixed templates stay arrays), unknown glyphs and
// unresolvable assets return null. This keeps the renderer tests focused
// on evaluation, not the icon implementation.
const KNOWN_GLYPHS = new Set([
	"video-frame",
	"music-notes",
	"gallery",
	"heart",
	"play",
	"file-text",
])

function renderIcon(ref: IconRef): ReturnType<RenderIcon> {
	if (ref.kind === "asset") {
		return createElement("span", null, `asset:${ref.url}`)
	}
	const name = normalizeSolarGlyphName(ref.name)
	return name !== undefined && KNOWN_GLYPHS.has(name)
		? createElement("span", null, `icon:${name}`)
		: null
}

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
	return {
		locale: "en",
		pluginId: "test-plugin",
		manifest: {
			i18n: {
				name: { en: "Test Plugin", zh: "测试插件" },
				label: { en: "Label", zh: "标签" },
			},
			ui: {
				search: {
					kinds: [
						{ key: "video", icon: "{{icon('Video')}}" },
						{ key: "audio", icon: "{{icon('Music')}}" },
						{ key: "image", icon: "{{icon('Image')}}" },
					],
				},
			},
		},
		iconClassName: "h-4 w-4",
		renderIcon,
		buildAssetUrl: (pluginId, path) => `/assets/${pluginId}/${path}`,
		...overrides,
	}
}

describe("renderCardTemplate", () => {
	test("substitutes a simple field", () => {
		const result = renderCardTemplate(
			"{{file.sizeBytes}}",
			{
				file: { sizeBytes: 1024 },
				source: undefined,
			},
			makeCtx(),
		)
		expect(result).toBe("1024")
	})

	test("applies bytes formatting", () => {
		const result = renderCardTemplate(
			"{{bytes(file.sizeBytes)}}",
			{ file: { sizeBytes: 1536 }, source: undefined },
			makeCtx(),
		)
		expect(result).toBe("1.5 KB")
	})

	test("applies duration formatting", () => {
		const result = renderCardTemplate(
			"{{duration(source.durationMs)}}",
			{ file: undefined, source: { durationMs: 125_000 } },
			makeCtx(),
		)
		expect(result).toBe("2:05")
	})

	test("formats long durations with hours", () => {
		const result = renderCardTemplate(
			"{{duration(source.durationMs)}}",
			{ file: undefined, source: { durationMs: 3_661_000 } },
			makeCtx(),
		)
		expect(result).toBe("1:01:01")
	})

	test("applies number formatting", () => {
		const result = renderCardTemplate(
			"{{number(file.count)}}",
			{ file: { count: 1234 }, source: undefined },
			makeCtx(),
		)
		expect(result).toBe("1,234")
	})

	test("reads from source namespace", () => {
		const result = renderCardTemplate(
			"{{source.width}}×{{source.height}}",
			{ file: undefined, source: { width: 1920, height: 1080 } },
			makeCtx(),
		)
		expect(result).toBe("1920×1080")
	})

	test("renders empty for missing fields", () => {
		const result = renderCardTemplate(
			"{{source.missing}}",
			{ file: undefined, source: {}, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})

	test("renders empty when namespace root is undefined", () => {
		const result = renderCardTemplate(
			"{{file.sizeBytes}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})

	test("leaves plain text untouched", () => {
		const result = renderCardTemplate(
			"hello world",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBe("hello world")
	})

	test("t() resolves i18n key", () => {
		const result = renderCardTemplate(
			"{{t('name')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBe("Test Plugin")
	})

	test("t() falls back to first key when locale missing", () => {
		const result = renderCardTemplate(
			"{{t('name')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx({ locale: "fr" }),
		)
		expect(result).toBe("Test Plugin")
	})

	test("t() returns empty for missing key", () => {
		const result = renderCardTemplate(
			"{{t('missing')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})

	test("kind() renders known kind icon", () => {
		const result = renderCardTemplate(
			"{{kind('video')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).not.toBeNull()
		expect(result).not.toBe("")
	})

	test("kind() returns null for unknown kind", () => {
		const result = renderCardTemplate(
			"{{kind('unknown')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})

	test("icon() renders known icon", () => {
		const result = renderCardTemplate(
			"{{icon('Heart')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).not.toBeNull()
		expect(result).not.toBe("")
	})

	test("icon() returns null for unknown name", () => {
		const result = renderCardTemplate(
			"{{icon('NotInRegistry')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})

	test("asset() renders img node", () => {
		const result = renderCardTemplate(
			"{{asset('icons/heart.gif')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx({ pluginId: "my-plugin" }),
		)
		expect(result).not.toBeNull()
		expect(result).not.toBe("")
	})

	test("mixed text and icon returns array", () => {
		const result = renderCardTemplate(
			"'{{icon('Play')}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(Array.isArray(result)).toBe(true)
	})

	test("invalid expression renders empty", () => {
		const result = renderCardTemplate(
			"{{}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})

	test("malformed expression renders empty", () => {
		const result = renderCardTemplate(
			"{{!!!}}",
			{ file: undefined, source: undefined, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toBeNull()
	})
})

describe("resolveLocaleString", () => {
	test("returns a plain string as-is", () => {
		expect(resolveLocaleString("hello", "en")).toBe("hello")
	})

	test("picks the exact locale match", () => {
		expect(resolveLocaleString({ en: "hello", zh: "你好" }, "zh")).toBe("你好")
	})

	test("falls back to base language for region codes", () => {
		expect(resolveLocaleString({ en: "hello", zh: "你好" }, "zh-CN")).toBe(
			"你好",
		)
	})

	test("falls back to first available when nothing matches", () => {
		expect(resolveLocaleString({ de: "Hallo" }, "en")).toBe("Hallo")
	})
})

describe("renderSlotBadges", () => {
	test("renders and filters empty results", () => {
		const result = renderSlotBadges(
			["{{bytes(file.sizeBytes)}}", "{{source.missing}}"],
			{ file: { sizeBytes: 1024 }, source: {}, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toHaveLength(1)
		expect(result[0]).toBe("1 KB")
	})

	test("slot value embeds {{t('key')}}", () => {
		const result = renderSlotBadges(
			["Label: {{t('label')}}, Bytes: {{bytes(file.sizeBytes)}}"],
			{ file: { sizeBytes: 1024 }, source: {}, searchMeta: undefined },
			makeCtx({ locale: "zh" }),
		)
		expect(result).toHaveLength(1)
		expect(result[0]).toBe("Label: 标签, Bytes: 1 KB")
	})

	test("kind() paints without facets; searchKindIcons() does not", () => {
		const scope = {
			file: undefined,
			source: undefined,
			searchMeta: undefined,
		}
		expect(
			renderSlotBadges(["{{kind('video')}}"], scope, makeCtx()),
		).toHaveLength(1)
		expect(
			renderSlotBadges(
				["{{join(' ', searchKindIcons(), number(source.animationCount))}}"],
				scope,
				makeCtx(),
			),
		).toHaveLength(0)
	})

	test("searchKindIcons() only includes active facets", () => {
		const result = renderSlotBadges(
			["{{join(' ', searchKindIcons(), number(source.animationCount))}}"],
			{
				file: undefined,
				source: { animationCount: 3 },
				searchMeta: { v: 1, facets: { video: true, audio: false } },
			},
			makeCtx(),
		)
		expect(result).toHaveLength(1)
		expect(result[0]).not.toBe("")
	})
})

describe("condition syntax", () => {
	test("eq compares primitives", () => {
		expect(
			renderCardTemplate(
				"{{if(eq(file.count, 2), 'yes')}}",
				{ file: { count: 2 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("yes")
	})

	test("eq returns empty when not equal", () => {
		expect(
			renderCardTemplate(
				"{{if(eq(file.count, 2), 'yes')}}",
				{ file: { count: 3 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBeNull()
	})

	test("gt compares numbers", () => {
		expect(
			renderCardTemplate(
				"{{if(gt(file.count, 1), file.count)}}",
				{ file: { count: 5 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe(5)
	})

	test("gt returns empty when not greater", () => {
		expect(
			renderCardTemplate(
				"{{if(gt(file.count, 1), file.count)}}",
				{ file: { count: 1 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBeNull()
	})

	test("lt compares numbers", () => {
		expect(
			renderCardTemplate(
				"{{if(lt(file.count, 3), 'small')}}",
				{ file: { count: 2 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("small")
	})

	test("gte compares numbers", () => {
		expect(
			renderCardTemplate(
				"{{if(gte(file.count, 1), 'ok')}}",
				{ file: { count: 1 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("ok")
	})

	test("lte compares numbers", () => {
		expect(
			renderCardTemplate(
				"{{if(lte(file.count, 1), 'single')}}",
				{ file: { count: 1 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("single")
	})

	test("ne compares primitives", () => {
		expect(
			renderCardTemplate(
				"{{if(ne(file.count, 1), 'many')}}",
				{ file: { count: 5 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("many")
	})

	test("if with else branch", () => {
		expect(
			renderCardTemplate(
				"{{if(gt(file.count, 1), file.count, 'one')}}",
				{ file: { count: 1 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("one")
	})

	test("number literals as arguments", () => {
		expect(
			renderCardTemplate(
				"{{if(eq(file.count, 1), 'single')}}",
				{ file: { count: 1 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("single")
	})

	test("nested calls", () => {
		expect(
			renderCardTemplate(
				"{{bytes(if(gt(file.sizeBytes, 1024), file.sizeBytes))}}",
				{ file: { sizeBytes: 2048 }, source: {}, searchMeta: undefined },
				makeCtx(),
			),
		).toBe("2 KB")
	})

	test("hide count when single file", () => {
		const result = renderSlotBadges(
			["{{if(gt(file.count, 1), file.count)}}"],
			{ file: { count: 1 }, source: {}, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toHaveLength(0)
	})

	test("show count when multiple files", () => {
		const result = renderSlotBadges(
			["{{if(gt(file.count, 1), file.count)}}"],
			{ file: { count: 5 }, source: {}, searchMeta: undefined },
			makeCtx(),
		)
		expect(result).toHaveLength(1)
		expect(result[0]).toBe(5)
	})
})
