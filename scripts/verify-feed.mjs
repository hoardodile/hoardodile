#!/usr/bin/env node
/**
 * Verify the generated update feed against the release artifacts and the
 * unified app version — the fragment that turns "build succeeded" into
 * "the updater will actually deliver this build". Run after packaging:
 * electron-builder writes `latest.yml` next to the installer.
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const releaseDir = join(root, "apps", "desktop", "release")

function fail(message) {
	console.error(`[verify-feed] ${message}`)
	process.exit(1)
}

function yamlTopLevel(text, key) {
	const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
	return match?.[1]?.trim() ?? null
}

function yamlFileUrl(text) {
	const match = text.match(/^[ \t]*- url:\s*(.+)$/m)
	return match?.[1]?.trim() ?? null
}

const { default: builderConfig } = await import(
	pathToFileURL(join(root, "apps", "desktop", "electron-builder.config.mjs"))
		.href
)
const productName = builderConfig.productName
const version = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).version

const ymlPath = join(releaseDir, "latest.yml")
if (!existsSync(ymlPath)) {
	fail(`missing ${ymlPath} — run the desktop packaging first`)
}
const yml = readFileSync(ymlPath, "utf8")
const ymlVersion = yamlTopLevel(yml, "version")
const ymlPathName = yamlTopLevel(yml, "path")
const ymlSha512 = yamlTopLevel(yml, "sha512")
const ymlUrl = yamlFileUrl(yml)

const exeName = `${productName}-Setup-${version}-x64.exe`
const exePath = join(releaseDir, exeName)

const problems = []

if (ymlVersion !== version) {
	problems.push(`latest.yml version ${ymlVersion} ≠ package.json ${version}`)
}
if (ymlPathName !== exeName) {
	problems.push(`latest.yml path ${ymlPathName} ≠ expected ${exeName}`)
}
if (ymlUrl !== exeName) {
	problems.push(`latest.yml files[0].url ${ymlUrl} ≠ expected ${exeName}`)
}
if (!existsSync(exePath)) {
	problems.push(`installer missing: ${exeName}`)
} else if (ymlSha512 === null) {
	problems.push("latest.yml has no sha512")
} else {
	const actual = createHash("sha512")
		.update(readFileSync(exePath))
		.digest("base64")
	if (actual !== ymlSha512) {
		problems.push("latest.yml sha512 does not match the installer on disk")
	}
}
if (!existsSync(`${exePath}.blockmap`)) {
	problems.push("installer blockmap missing (differential updates broken)")
}

const zipEntries = readdirSync(releaseDir).filter((name) =>
	name.startsWith(`${productName}-${version}-`),
)
if (zipEntries.length === 0) {
	problems.push("portable zip missing (clean installs without the installer)")
}

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`[verify-feed] - ${problem}`)
	}
	fail("update feed is not consistent with the release artifacts")
}

console.log(
	`verified update feed in ${releaseDir} (v${version}: ${exeName}, sha512 ok, blockmap ok, zip ok)`,
)
