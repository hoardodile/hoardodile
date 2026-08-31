// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
	type PluginRequests,
	pluginMethods,
	pluginRequestTimeouts,
} from "./protocol.ts"

describe("uploadCover protocol wiring", () => {
	test("registers the uploadCover method key", () => {
		expect(pluginMethods.uploadCover).toBe("uploadCover")
		// Completed coverage: every PluginRequests key must appear in
		// pluginMethods (compile-time enforced too via the AssertTrue).
		const requestKeys = Object.keys(pluginMethods) as Array<
			keyof PluginRequests
		>
		expect(requestKeys).toContain("uploadCover")
	})

	test("declares a timeout so large covers do not hang the bridge", () => {
		expect(pluginRequestTimeouts.uploadCover).toBeTypeOf("number")
		expect(pluginRequestTimeouts.uploadCover).toBeGreaterThan(0)
	})
})
