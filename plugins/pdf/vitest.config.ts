import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		css: false,
		include: ["src/**/*.test.{ts,tsx}"],
		maxWorkers: 2,
	},
})
