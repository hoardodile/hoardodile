import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		// The embedded template copy is data, not code under test.
		exclude: ["src/template/**", "node_modules/**", "dist/**"],
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
	},
})
