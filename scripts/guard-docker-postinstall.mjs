#!/usr/bin/env node
/**
 * Guard the Dockerfile's manifest-first install against workspace packages
 * whose install-time lifecycle script (preinstall/install/postinstall)
 * references a file inside that same package.
 *
 * The Dockerfile copies only each workspace package's package.json (+ the
 * lockfile and workspace yaml) and runs `pnpm install --frozen-lockfile`
 * *before* `COPY . .`. So a workspace package whose postinstall runs e.g.
 * `node scripts/setup-hooks.mjs` hits `MODULE_NOT_FOUND` unless that file is
 * copied in the manifest-first stage too. This guard enforces that invariant
 * so the regression can't silently reach a release.
 *
 * Usage:
 *   node scripts/guard-docker-postinstall.mjs                    # checks ./Dockerfile
 *   node scripts/guard-docker-postinstall.mjs --dockerfile X    # checks a copy (testing)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Lifecycle scripts pnpm runs at install time for a workspace package. */
export const INSTALL_LIFECYCLE_SCRIPTS = new Set([
	"preinstall",
	"install",
	"postinstall",
])

/** A relative path argument that follows `node ` inside a lifecycle script. */
const NODE_PATH_ARG = /(?:^|\s)node\s+(?![\s;&|"'`])([^\s;&|"'`]+)/g

/** Extract the manifest-first COPY sources from the Dockerfile (before install). */
export function parseManifestCopies(dockerfileText) {
	const copies = []
	let inManifest = false
	for (const raw of dockerfileText.split(/\r?\n/)) {
		const line = raw.trim()
		if (!inManifest) {
			if (/^COPY\s/.test(line)) inManifest = true
			else continue
		}
		// The manifest-first block ends at the install RUN (everything after,
		// including `COPY . .`, is the full-context copy and does not count).
		if (/^RUN\s/.test(line) && /pnpm\s+install/.test(line)) break
		const match = line.match(/^COPY\s+(\S+)\s+\S+/)
		if (match) copies.push(match[1])
	}
	return copies
}

/** Find the install-time lifecycle scripts declared by a package.json. */
export function findLifecycleScripts(packageJson) {
	const scripts = packageJson.scripts ?? {}
	const result = {}
	for (const name of INSTALL_LIFECYCLE_SCRIPTS) {
		if (typeof scripts[name] === "string" && scripts[name] !== "") {
			result[name] = scripts[name]
		}
	}
	return result
}

/** Resolve a lifecycle script to the package-local file paths it references. */
export function referencedPackageFiles(pkgDir, script) {
	const refs = []
	for (const match of script.matchAll(NODE_PATH_ARG)) {
		const arg = match[1]
		if (arg.startsWith("-")) continue
		if (arg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(arg)) continue
		const repoRel = posix.normalize(posix.join(pkgDir, arg))
		// Only report paths that exist on disk in the repo (real files), so a
		// sub-command like `lefthook install` or a `npx` bin is never a finding.
		if (existsSync(resolve(process.cwd(), repoRel))) {
			refs.push(repoRel)
		}
	}
	return refs
}

function isDirectory(repoRel) {
	try {
		return statSync(resolve(process.cwd(), repoRel)).isDirectory()
	} catch {
		return false
	}
}

/** True when a manifest-first COPY source covers the referenced file path. */
function isCovered(repoRel, copySrcs) {
	for (const src of copySrcs) {
		const s = src.replace(/\\/g, "/")
		if (isDirectory(s)) {
			const base = s.replace(/\/+$/, "")
			if (repoRel === base || repoRel.startsWith(`${base}/`)) return true
		} else if (repoRel === s) {
			return true
		}
	}
	return false
}

/** Enumerate the workspace package.json dirs (root + apps/packages/plugins/*). */
export function workspacePackageDirs() {
	const dirs = ["."]
	for (const base of ["apps", "packages", "plugins"]) {
		if (!existsSync(resolve(process.cwd(), base))) continue
		for (const entry of readdirSync(resolve(process.cwd(), base), {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) continue
			const pkg = `${base}/${entry.name}/package.json`
			if (existsSync(resolve(process.cwd(), pkg)))
				dirs.push(`${base}/${entry.name}`)
		}
	}
	return dirs
}

export function findViolations(dockerfileText) {
	const copySrcs = parseManifestCopies(dockerfileText)
	const findings = []
	for (const pkgDir of workspacePackageDirs()) {
		const pkgPath = pkgDir === "." ? "package.json" : `${pkgDir}/package.json`
		if (!existsSync(resolve(process.cwd(), pkgPath))) continue
		const packageJson = JSON.parse(
			readFileSync(resolve(process.cwd(), pkgPath), "utf8"),
		)
		const lifecycle = findLifecycleScripts(packageJson)
		for (const [name, script] of Object.entries(lifecycle)) {
			for (const repoRel of referencedPackageFiles(pkgDir, script)) {
				if (!isCovered(repoRel, copySrcs)) {
					findings.push(
						`${pkgPath}: ${name} \`${script}\` needs \`${repoRel}\`, but the Dockerfile does not COPY it in the manifest-first stage — add a COPY for its directory before \`RUN ... pnpm install\`.`,
					)
				}
			}
		}
	}
	return findings
}

function main() {
	const dockerfile = process.argv.includes("--dockerfile")
		? process.argv[process.argv.indexOf("--dockerfile") + 1]
		: "Dockerfile"
	if (!existsSync(resolve(process.cwd(), dockerfile))) {
		console.error(
			`guard-docker-postinstall: Dockerfile not found: ${dockerfile}`,
		)
		process.exit(1)
	}

	const findings = findViolations(
		readFileSync(resolve(process.cwd(), dockerfile), "utf8"),
	)

	if (findings.length > 0) {
		console.error("\nDocker manifest-first postinstall guard failed:")
		for (const finding of findings) {
			console.error(`  - ${finding}`)
		}
		console.error(
			`\nThe Dockerfile's manifest-first install copies only package.json files
and runs \`pnpm install --frozen-lockfile\` before \`COPY . .\`. Any workspace
package whose preinstall/install/postinstall references a file inside that
package must have that file copied in the manifest-first stage too, or the
container build dies with MODULE_NOT_FOUND.`,
		)
		process.exit(1)
	}

	console.log("Docker manifest-first postinstall guard passed.")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main()
}
