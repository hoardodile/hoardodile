import { defineConfig } from "@playwright/test"

/**
 * Desktop launch smoke against the PACKAGED app (run `pnpm package:dir`
 * first): the wizard → first-run claim → sidecar health → relaunch
 * persistence. Slow on purpose: the first boot runs DB migrations against
 * a cold sidecar.
 */
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 240_000,
	reporter: process.env.CI ? [["list"], ["html"]] : [["list"]],
	outputDir: ".playwright-desktop",
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
})
