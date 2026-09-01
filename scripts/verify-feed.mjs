#!/usr/bin/env node
/**
 * Verify the generated update feed against the release artifacts and the
 * unified app version — the fragment that turns "build succeeded" into
 * "the updater will actually deliver this build". Run after packaging:
 * electron-builder writes latest*.yml next to the artifacts.
 *
 * The check is yml-driven (no hardcoded artifact names): the feed's own
 * `version`, `path`, `sha512` and `files[].url` entries must all line up
 * with the release directory. Platform extras stay outside the feed:
 *   - win   the portable zip must exist (clean installs without the
 *           installer); blockmap coverage comes from files[].
 *   - mac   the dmg must exist (the zip is the update artifact).
 *   - linux nothing extra — AppImage updates read latest-linux.yml only.
 *
 * Usage:
 *   node scripts/verify-feed.mjs                   # Windows (latest.yml)
 *   node scripts/verify-feed.mjs --platform mac
 *   node scripts/verify-feed.mjs --platform linux
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const releaseDir = join(root, "apps", "desktop", "release")

const args = parseArgs(process.argv.slice(2))
const platform = args.platform ?? "win"
const feedNames = {
	win: "latest.yml",
	mac: "latest-mac.yml",
	linux: "latest-linux.yml",
}
const feedName = feedNames[platform]
if (feedName === undefined) {
	console.error(
		`[verify-feed] unknown --platform ${platform} (win | mac | linux)`,
	)
	process.exit(1)
}

function fail(message) {
	console.error(`[verify-feed] ${message}`)
	process.exit(1)
}

function yamlTopLevel(text, key) {
	const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
	return match?.[1]?.trim() ?? null
}

function yamlFileUrls(text) {
	const urls = []
	for (const match of text.matchAll(/^[ \t]*- url:\s*(.+)$/gm)) {
		const url = match[1]?.trim()
		if (url !== undefined && url.length > 0) urls.push(url)
	}
	return urls
}

const { default: builderConfig } = await import(
	pathToFileURL(join(root, "apps", "desktop", "electron-builder.config.mjs"))
		.href
)
const productName = builderConfig.productName
const version = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).version

const ymlPath = join(releaseDir, feedName)
if (!existsSync(ymlPath)) {
	fail(`missing ${ymlPath} — run the desktop packaging for ${platform} first`)
}
const yml = readFileSync(ymlPath, "utf8")
const ymlVersion = yamlTopLevel(yml, "version")
const ymlPathName = yamlTopLevel(yml, "path")
const ymlSha512 = yamlTopLevel(yml, "sha512")

const problems = []
const updateFile = ymlPathName === null ? null : join(releaseDir, ymlPathName)

if (ymlVersion !== version) {
	problems.push(`feed version ${String(ymlVersion)} ≠ package.json ${version}`)
}
if (updateFile === null || !existsSync(updateFile)) {
	problems.push(`feed path missing from release dir: ${String(ymlPathName)}`)
} else if (ymlSha512 === null) {
	problems.push("feed has no sha512")
} else {
	const actual = createHash("sha512")
		.update(readFileSync(updateFile))
		.digest("base64")
	if (actual !== ymlSha512) {
		problems.push("feed sha512 does not match the update artifact on disk")
	}
}
for (const url of yamlFileUrls(yml)) {
	if (!existsSync(join(releaseDir, url))) {
		problems.push(`files[] entry missing from release dir: ${url}`)
	}
}

const artifacts = readdirSync(releaseDir)
const expectedPrefix = `${productName}-${version}-`
if (platform === "win") {
	if (
		!artifacts.some(
			(name) => name.startsWith(expectedPrefix) && name.endsWith(".zip"),
		)
	) {
		problems.push("portable zip missing (clean installs without the installer)")
	}
}
if (platform === "mac") {
	if (
		!artifacts.some(
			(name) => name.startsWith(expectedPrefix) && name.endsWith(".dmg"),
		)
	) {
		problems.push("dmg missing (installer for the update artifact)")
	}
}

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`[verify-feed] - ${problem}`)
	}
	fail(`${feedName} is not consistent with the release artifacts`)
}

console.log(
	`verified update feed in ${releaseDir} (v${version} ${platform}: ${String(ymlPathName)}, sha512 ok, files ok)`,
)

function parseArgs(argv) {
	const out = {}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--platform") {
			out.platform = argv[++index]
			if (out.platform === undefined)
				throw new Error("--platform needs a value")
			continue
		}
		throw new Error(`unknown argument: ${arg}`)
	}
	return out
}
