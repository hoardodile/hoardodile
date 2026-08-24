import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		include: ["src/**/*.test.ts"],
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
	},
})
