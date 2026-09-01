import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		// The template is copied into dist/template at build, not unit-tested here.
		exclude: ["node_modules/**", "dist/**"],
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
	},
})
