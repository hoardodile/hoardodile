import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		// The mock host exercises the postMessage bridge against a window.
		environment: "jsdom",
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
	},
})
