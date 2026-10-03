#!/usr/bin/env node
/**
 * Audit gate for the npm release: fail only when a package this repo
 * publishes — or one of its dependencies — carries an advisory.
 *
 * `pnpm audit --prod` runs against the whole workspace, so it also reports
 * the app workspaces (apps/server, apps/desktop, apps/web), which never
 * reach npm: a new high advisory in one of them tells a consumer nothing
 * but blocked the v0.2.1 and v0.2.5 publishes at the gate step.
 *
 * pnpm prefixes every finding path with the importing workspace directory
 * (separators encoded as `__`: `packages/i18n` → `packages__i18n`,
 * `apps/server` → `apps__server`), so each finding is attributed to its
 * importer's dependency closure and kept only when that importer is in
 * scripts/lib/release-packages.mjs — the release table stays the single
 * source of truth for what ships to npm. Out-of-scope findings are listed
 * as ignored rather than dropped silently.
 *
 * Level and ignores stay where pnpm already reads them
 * (pnpm-workspace.yaml's `audit` block), so a local `pnpm audit --prod`
 * reports exactly what this gate judges.
 *
 *   node scripts/audit-release-set.mjs
 */

import { execFileSync } from "node:child_process"
import { needsShell } from "./lib/process.mjs"
import { PUBLISHED_PACKAGES } from "./lib/release-packages.mjs"

/** pnpm's encoding of a workspace directory at the root of an audit path. */
function importerId(dir) {
	return dir.replaceAll("/", "__")
}

/**
 * The findings whose dependency closure belongs to a published package,
 * plus the advisories that only affect unpublished workspaces.
 */
function partitionFindings(report) {
	const scope = new Set(PUBLISHED_PACKAGES.map((pkg) => importerId(pkg.dir)))
	const inScope = []
	const ignored = []
	for (const advisory of Object.values(report.advisories ?? {})) {
		const paths = []
		const roots = new Set()
		for (const finding of advisory.findings ?? []) {
			for (const path of finding.paths ?? []) {
				const root = path.split(">")[0]
				if (scope.has(root)) paths.push(path)
				else roots.add(root)
			}
		}
		if (paths.length > 0) {
			inScope.push({ advisory, paths })
		} else {
			ignored.push({ advisory, roots: [...roots] })
		}
	}
	return { inScope, ignored }
}

/**
 * pnpm exits 1 as soon as it reports an advisory, so the report is read
 * from the error's stdout. A run that produced no report at all (registry
 * failure, crash) must fail the gate instead of passing it silently.
 */
function readReport() {
	try {
		return JSON.parse(
			execFileSync("pnpm", ["audit", "--prod", "--json"], {
				encoding: "utf8",
				// Windows resolves pnpm through its .cmd shim, which Node
				// refuses to spawn without a shell (scripts/lib/process.mjs).
				shell: needsShell,
				stdio: ["ignore", "pipe", "pipe"],
			}),
		)
	} catch (error) {
		try {
			return JSON.parse(error.stdout ?? "")
		} catch {
			const detail = [error.stderr, error.stdout, error.message]
				.filter((part) => typeof part === "string" && part.trim() !== "")
				.join("\n")
			throw new Error(`pnpm audit produced no report:\n${detail}`, {
				cause: error,
			})
		}
	}
}

function reportFinding({ advisory, paths }) {
	console.error(
		`✗ ${advisory.severity}  ${advisory.module_name}  ${advisory.title}`,
	)
	console.error(`  patched: ${advisory.patched_versions}`)
	for (const path of paths) console.error(`  ${path}`)
	console.error(`  ${advisory.url}`)
}

function reportIgnored(ignored) {
	if (ignored.length === 0) return
	console.log(
		`\n${ignored.length} advisor${
			ignored.length === 1 ? "y" : "ies"
		} outside the release set — unpublished workspaces, not gating npm:`,
	)
	for (const { advisory, roots } of ignored) {
		const id = advisory.github_advisory_id ?? advisory.url ?? advisory.id
		const where = roots.length > 0 ? ` (${roots.join(", ")})` : ""
		console.log(`  ${advisory.severity} ${advisory.module_name} ${id}${where}`)
	}
}

function main() {
	const { inScope, ignored } = partitionFindings(readReport())
	console.log(
		`Release-set audit — ${PUBLISHED_PACKAGES.length} published packages: ${PUBLISHED_PACKAGES.map(
			(pkg) => pkg.name,
		).join(", ")}`,
	)
	reportIgnored(ignored)
	if (inScope.length === 0) {
		console.log("\nNo advisories in the published dependency closure.")
		return
	}
	console.error(
		`\n${inScope.length} advisor${
			inScope.length === 1 ? "y" : "ies"
		} in the published dependency closure:`,
	)
	for (const finding of inScope) reportFinding(finding)
	process.exitCode = 1
}

main()
