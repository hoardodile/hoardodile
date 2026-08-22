import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		// The sandbox tests spawn real worker threads, which are slow to
		// boot under Windows CI and parallel turbo test runs.
		testTimeout: 30_000,
		hookTimeout: 30_000,
		pool: "threads",
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
	},
})
