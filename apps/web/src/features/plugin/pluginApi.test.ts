/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	pluginUninstallMutation,
	pluginUsageCountQueryOptions,
	previewInitContextQueryOptions,
} from "./pluginApi"

describe("previewInitContextQueryOptions", () => {
	it("keys the bootstrap payload per plugin+resource with a short staleness window", () => {
		const opts = previewInitContextQueryOptions({
			pluginId: "p-1",
			resId: "r-1",
		})
		expect(opts.queryKey).toEqual([
			"plugin",
			"previewInitContext",
			"p-1",
			"r-1",
		])
		expect(opts.staleTime).toBe(30_000)
	})
})

describe("plugin usage count + uninstall", () => {
	it("keys the usage count query per plugin", () => {
		const opts = pluginUsageCountQueryOptions("p-1")
		expect(opts.queryKey).toEqual(["plugin", "usageCount", "p-1"])
	})

	it("exposes the uninstall mutation for the plugin namespace", () => {
		expect(typeof pluginUninstallMutation().mutationFn).toBe("function")
	})
})
