import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
	testDir: "./e2e/mobile-back",
	testMatch: "*.spec.ts",
	workers: 1,
	retries: 0,
	outputDir: "./test-results/mobile-back",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:4327",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
		{ name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
	],
	webServer: {
		command: "pnpm exec vite --config e2e/mobile-back/vite.config.ts",
		url: "http://127.0.0.1:4327",
		reuseExistingServer: false,
	},
})
