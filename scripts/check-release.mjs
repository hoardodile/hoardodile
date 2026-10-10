#!/usr/bin/env node
/**
 * Shared npm release checks, run locally before release-it can bump/tag
 * and again in release.yml before publishing. Never publishes packages.
 *
 *   pnpm release:check
 */

import { run } from "./lib/process.mjs"
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

// Cheap checks first: catch version drift and advisories before building.
// Audit stays scoped to published packages; its policy is in pnpm-workspace.yaml.
const checks = [
	"version:check",
	"audit:release-set",
	"build",
	"sdks:pack",
	"licenses:check",
]

try {
	for (const check of checks) {
		run("pnpm", [check], { cwd: WORKSPACE_ROOT })
	}
	console.log("npm release checks passed.")
} catch (error) {
	console.error(`npm release checks failed: ${error.message}`)
	process.exitCode = 1
}
