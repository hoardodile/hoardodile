#!/usr/bin/env node
/**
 * Ensure the GitHub Release draft for `v<version>` exists and carries the
 * changelog notes. The first job of the release workflow: electron-builder
 * would otherwise auto-create an empty draft (name = version, no body) when
 * a local release-it fell back to web mode, and a manual `workflow_dispatch`
 * re-run needs the same invariants. Idempotent — only creates or fills when
 * needed, and normalizes the title; it never touches a draft that already
 * carries notes.
 *
 *   --version <v>   dispatch input; must equal the root package.json
 *   --dry-run       print the actions instead of executing them (local use)
 *
 * Requires the `gh` CLI and GH_TOKEN (both present on GitHub runners).
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { latestReleaseNotes } from "./lib/changelog.mjs"

const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run")

function argValue(flag) {
	const index = args.indexOf(flag)
	return index >= 0 ? args[index + 1] : undefined
}

function run(command, shellArgs, { capture = false, readOnly = false } = {}) {
	// Dry-run prints mutations; reads (tag check, release view) still
	// execute so the report shows what the real run would decide.
	if (isDryRun && !readOnly) {
		console.log(`[dry-run] $ ${command} ${shellArgs.join(" ")}`)
		return ""
	}
	try {
		const output = execFileSync(command, shellArgs, {
			encoding: "utf8",
			stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
		})
		// Inherited stdio yields no stdout (null); only capture mode reads it.
		return capture ? output.trim() : ""
	} catch (error) {
		const detail = error.stdout || error.stderr || error.message
		if (capture) throw new Error(`${command} ${shellArgs.join(" ")}: ${detail}`)
		console.error(`${command} ${shellArgs.join(" ")} failed: ${detail}`)
		process.exit(error.status ?? 1)
	}
}

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"))
const rootVersion = rootPackage.version

const version = argValue("--version") ?? rootVersion
const tag = `v${version}`

if (argValue("--version") !== undefined && version !== rootVersion) {
	console.error(
		`--version ${version} does not match the root package.json version ${rootVersion}`,
	)
	process.exit(1)
}

// Resolve the repository from package.json so this stays repo-agnostic.
const repository = rootPackage.repository?.url ?? ""
const match = repository.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
if (match === null) {
	console.error(`cannot resolve owner/repo from repository.url ${repository}`)
	process.exit(1)
}
const [, owner, repo] = match
const ghRepo = `${owner}/${repo}`

// The tag must exist: a release cannot be drafted for a version that was
// never tagged. Dispatch checkouts are shallow (no local tags) — query origin.
if (
	run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], {
		capture: true,
		readOnly: true,
	}) === ""
) {
	console.error(`tag ${tag} does not exist on origin — nothing to release`)
	process.exit(1)
}

const notesFile = join(
	mkdtempSync(join(tmpdir(), "hd-release-notes-")),
	"notes.md",
)
writeFileSync(notesFile, `${latestReleaseNotes()}\n`)

let body = ""
try {
	body = run(
		"gh",
		[
			"release",
			"view",
			tag,
			"--repo",
			ghRepo,
			"--json",
			"body",
			"--jq",
			".body",
		],
		{
			capture: true,
			readOnly: true,
		},
	)
} catch {
	run("gh", [
		"release",
		"create",
		tag,
		"--repo",
		ghRepo,
		"--draft",
		"--title",
		tag,
		"--notes-file",
		notesFile,
	])
	console.log(`created draft ${tag} with release notes`)
	process.exit(0)
}

if (body === "") {
	run("gh", [
		"release",
		"edit",
		tag,
		"--repo",
		ghRepo,
		"--title",
		tag,
		"--notes-file",
		notesFile,
	])
	console.log(`filled empty body of draft ${tag}`)
} else {
	run("gh", ["release", "edit", tag, "--repo", ghRepo, "--title", tag])
	console.log(`draft ${tag} already has notes; title normalized`)
}
