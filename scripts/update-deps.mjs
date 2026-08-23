#!/usr/bin/env node
/**
 * "Update everything to latest" that never touches load-bearing pins.
 *
 * pnpm's `up` has no exclude mechanism, so instead of a blanket
 * `pnpm up -L` this script enumerates every direct external dependency of
 * the root project, each workspace package and the pnpm workspace catalog,
 * then upgrades them explicitly — skipping the protected set declared in
 * `scripts/guard-protected-deps.mjs` (BlockNote + suggest-changes, the
 * document-diff machinery) and `typescript` (5.9.3 tsup pin / catalog
 * 7.0.2). The guard runs afterwards as confirmation.
 *
 * Usage:
 *   node scripts/update-deps.mjs [-- <pnpm flags>]
 * Extra pnpm flags after `--` (e.g. `-- --ignore-scripts`) are forwarded.
 */

import { execSync } from "node:child_process"
import { globSync, readFileSync } from "node:fs"
import { PROTECTED_PACKAGE_NAMES } from "./guard-protected-deps.mjs"

const flagSeparator = process.argv.indexOf("--")
const PNPM_FLAGS =
	flagSeparator >= 0 ? process.argv.slice(flagSeparator + 1) : []

function runPnpm(args) {
	const quoted = [...PNPM_FLAGS, ...args].map((arg) =>
		/\s/.test(arg) ? `"${arg}"` : arg,
	)
	execSync(`pnpm ${quoted.join(" ")}`, { stdio: "inherit" })
}

function dependencyNames(pkg) {
	const names = new Set()
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		for (const name of Object.keys(pkg[section] ?? {})) {
			names.add(name)
		}
	}
	return names
}

function readManifest(path) {
	return JSON.parse(readFileSync(path, "utf8"))
}

function workspaceManifestPaths() {
	const yaml = readFileSync("pnpm-workspace.yaml", "utf8")
	const patterns = [...yaml.matchAll(/^ {2}- (.+)$/gm)].map((match) =>
		match[1].trim(),
	)
	return patterns
		.flatMap((pattern) => globSync(`${pattern}/package.json`))
		.filter((path) => !path.includes("node_modules"))
		.sort()
}

function catalogNames() {
	const yaml = readFileSync("pnpm-workspace.yaml", "utf8")
	const names = new Set()
	let inCatalog = false
	for (const line of yaml.split(/\r?\n/)) {
		if (line.trim() === "catalog:") {
			inCatalog = true
			continue
		}
		if (!inCatalog) continue
		if (!line.startsWith("  ")) break
		const match = line.match(/^ {2}(.+?):\s*\S/)
		if (match) names.add(match[1].trim().replace(/^'|'$/g, ""))
	}
	return names
}

function isSkippable(name) {
	return (
		PROTECTED_PACKAGE_NAMES.has(name) ||
		name.startsWith("@hoardodile/") ||
		name === "hoardodile"
	)
}

function updatable(pkg) {
	return [...dependencyNames(pkg)].filter((name) => !isSkippable(name))
}

function main() {
	const root = readManifest("package.json")
	const rootNames = updatable(root)
	const workspaces = workspaceManifestPaths().map((path) => {
		const pkg = readManifest(path)
		return { name: pkg.name, names: updatable(pkg) }
	})

	// Catalog entries live in pnpm-workspace.yaml and are referenced as
	// `catalog:` from manifests; the names must be passed explicitly too.
	const catalog = [...catalogNames()].filter((name) => !isSkippable(name))

	if (rootNames.length > 0) {
		runPnpm(["up", "-L", ...rootNames])
	}
	for (const workspace of workspaces) {
		if (workspace.names.length === 0) continue
		runPnpm(["-F", workspace.name, "up", "-L", ...workspace.names])
	}
	// Catalog-only entries that no direct manifest pass touched yet.
	const touched = new Set([
		...rootNames,
		...workspaces.flatMap((workspace) => workspace.names),
	])
	const catalogOnly = catalog.filter((name) => !touched.has(name))
	if (catalogOnly.length > 0) {
		runPnpm(["up", "-L", ...catalogOnly])
	}

	// Belt and braces: confirm the protected set did not move.
	execSync("node scripts/guard-protected-deps.mjs", { stdio: "inherit" })
}

main()
