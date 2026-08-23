import { defineConfig } from "vitest/config"

// Pure-logic tests only (config normalization, the plugin HTML shell) —
// no jsdom; the storage fake lives in the test itself.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
})
