// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { pickReadmeMarkdown } from "./MarketplaceDetailDialog"

describe("pickReadmeMarkdown", () => {
	const readme = {
		en: "# Fallback",
		zh: "# 说明",
		"zh-CN": "# 简中",
		ja: "# 説明",
	}

	test("returns the exact locale when present", () => {
		expect(pickReadmeMarkdown(readme, "zh")).toBe("# 说明")
		expect(pickReadmeMarkdown(readme, "ja")).toBe("# 説明")
	})

	test("collapses a region code to the base language", () => {
		expect(pickReadmeMarkdown(readme, "zh-CN")).toBe("# 简中")
		expect(pickReadmeMarkdown(readme, "zh-TW")).toBe("# 说明")
	})

	test("falls back to en (the bare README.md) for a missing locale", () => {
		expect(pickReadmeMarkdown(readme, "en")).toBe("# Fallback")
		expect(pickReadmeMarkdown(readme, "fr")).toBe("# Fallback")
	})

	test("returns undefined when no readme is shipped", () => {
		expect(pickReadmeMarkdown(undefined, "en")).toBeUndefined()
	})

	test("falls back to the only shipped language when en is absent", () => {
		expect(pickReadmeMarkdown({ zh: "# 说明" }, "en")).toBe("# 说明")
		expect(pickReadmeMarkdown({ ja: "# 説明", zh: "# 说明" }, "fr")).toBe(
			"# 説明",
		)
	})
})
