import { describe, expect, it } from "vitest"
import { assertPluginShape, definePlugin } from "./define-plugin.ts"

/** Cast a deliberately-broken definition past the type level. */
const broken = (value: unknown) => value as Parameters<typeof definePlugin>[0]

describe("definePlugin", () => {
	it("freezes a valid definition", () => {
		const plugin = definePlugin({ detect: async () => ({ ok: true }) })
		expect(Object.isFrozen(plugin)).toBe(true)
	})

	it("rejects unknown hook keys with a friendly error", () => {
		expect(() =>
			definePlugin(
				broken({
					detect: async () => ({ ok: true }),
					sourceMetaa: async () => ({}),
				}),
			),
		).toThrow(/unknown hook\(s\) "sourceMetaa"/)
	})

	it("rejects a missing detect", () => {
		expect(() =>
			definePlugin(broken({ sourceMeta: async () => ({}) })),
		).toThrow(/missing detect\(\)/)
	})

	it("rejects synchronous hooks", () => {
		expect(() =>
			definePlugin(broken({ detect: () => ({ ok: true }) })),
		).toThrow(/"detect" must be an async function/)
	})

	it("accepts every optional hook when async", () => {
		expect(() =>
			definePlugin({
				detect: async () => ({ ok: true }),
				sourceMeta: async () => ({}),
				searchMeta: async () => ({}),
				coverLocal: async () => undefined,
				listFiles: async () => [],
			}),
		).not.toThrow()
	})

	it("assertPluginShape narrows valid values", () => {
		const value: unknown = { detect: async () => ({ ok: true }) }
		assertPluginShape(value)
		expect(typeof value.detect).toBe("function")
	})
})
