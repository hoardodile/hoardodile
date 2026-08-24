#!/usr/bin/env node
/**
 * Upload the resource pack (manifest + every layer tarball) of this
 * build to the release draft.
 *
 * Driven by PACK_UPLOAD in scripts/lib/resource-pack-targets.mjs: every
 * supported platform builds + verifies its pack in CI, only the matrix
 * entries marked true attach it to the GitHub Release (win32 today).
 * The client picks the artifacts up by stable name via
 * `releases/latest/download/…` — drafts stay invisible, so the existing
 * human review gate applies to the resource channel unchanged.
 *
 * Requires the `gh` CLI (preinstalled on GitHub runners) and
 * GH_TOKEN/GITHUB_TOKEN in the environment.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	normalizeTarget,
	PACK_UPLOAD,
	packFileNames,
	resolvePackTarget,
} from "../../../scripts/lib/resource-pack-targets.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const releaseDir = join(desktopRoot, "release")

const args = parseArgs(process.argv.slice(2))
const target = normalizeTarget(args.platform ?? process.platform)
const resolved = resolvePackTarget(target)
if (resolved === undefined || PACK_UPLOAD[resolved.platform] !== true) {
	console.log(
		`[upload-resources-pack] skipping upload for ${resolved?.slug ?? target} (PACK_UPLOAD off)`,
	)
	process.exit(0)
}

const version = JSON.parse(
	readFileSync(join(workspaceRoot, "package.json"), "utf8"),
).version
const names = packFileNames(resolved)
const stem = `resources-layer-${resolved.slug}-${resolved.arch}-`
const layerFiles = readdirSync(releaseDir)
	.filter((name) => name.startsWith(stem) && name.endsWith(".tar.gz"))
	.sort()
	.map((name) => join(releaseDir, name))
const files = [join(releaseDir, names.manifest), ...layerFiles]
for (const file of files) {
	if (!existsSync(file)) {
		console.error(`[upload-resources-pack] missing artifact: ${file}`)
		process.exit(1)
	}
}
if (layerFiles.length === 0) {
	console.error(
		`[upload-resources-pack] no ${stem}*.tar.gz layer artifacts found in ${releaseDir}`,
	)
	process.exit(1)
}

const tag = `v${version}`
const result = spawnSync("gh", ["release", "upload", tag, ...files], {
	stdio: "inherit",
})
if (result.status !== 0) {
	console.error(
		`[upload-resources-pack] gh release upload failed (exit ${String(result.status)})`,
	)
	process.exit(1)
}

console.log(
	`uploaded ${layerFiles.length} layer archives (+${names.manifest}) to ${tag} (${resolved.slug}-${resolved.arch})`,
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
