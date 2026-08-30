#!/usr/bin/env node
/**
 * Verify the generated resource pack against the staged tree, the shell
 * bundle and the unified app version — the fragment that turns "packaging
 * succeeded" into "the resource channel will actually deliver this
 * build". Run after build-resources-pack.mjs.
 *
 * Checks (mirrors verify-feed.mjs's yml-driven style, but strictly typed):
 *   - manifest metadata lines up with the release directory and the
 *     unified app version;
 *   - every layer tarball's sha256/size/identity matches the manifest
 *     (this is the client's integrity root — a tampered layer fails
 *     here, not on user machines);
 *   - layer tarballs contain exactly their expected entries, no
 *     absolute paths, no `..` traversal, no symlinks, no `.asar` files;
 *   - the embedded marker is the current release's;
 *   - shellHash equals a fresh content hash of the shell bundle (out/).
 *
 * Usage:
 *   node scripts/verify-resources-pack.mjs                   # win target
 *   node scripts/verify-resources-pack.mjs --platform linux
 *   node scripts/verify-resources-pack.mjs --platform mac
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as tar from "tar"
import {
	normalizeTarget,
	packFileNames,
	resolvePackTarget,
} from "./lib/resource-pack-targets.mjs"
import { contentHashTree, SHELL_HASH_BOUNDARY } from "./lib/shell-hash.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const desktopRoot = join(root, "apps", "desktop")
const releaseDir = join(desktopRoot, "release")
const stagedRoot = join(desktopRoot, "extra-resources")
const shellOutDir = join(desktopRoot, "out")

/** Mirrors PACK_LAYERS in apps/desktop/scripts/build-resources-pack.mjs. */
const LAYERS = [
	{
		name: "node",
		root: ["node"],
		excludePrefixes: [],
		topLevel: ["node"],
		containsEntries: (path) => path === "node" || path.startsWith("node/"),
	},
	{
		name: "server-dist",
		root: ["server"],
		excludePrefixes: ["node_modules"],
		topLevel: ["server"],
		containsEntries: (path) =>
			(path === "server" || path.startsWith("server/")) &&
			path !== "server/node_modules" &&
			!path.startsWith("server/node_modules/"),
		mustNotContain: (path) =>
			path === "server/node_modules" || path.startsWith("server/node_modules/"),
	},
	{
		name: "server-node_modules",
		root: ["server", "node_modules"],
		excludePrefixes: [],
		topLevel: ["server"],
		containsEntries: (path) =>
			path === "server/node_modules" || path.startsWith("server/node_modules/"),
	},
	{
		name: "plugins",
		root: ["plugins"],
		excludePrefixes: [],
		topLevel: ["plugins"],
		containsEntries: (path) =>
			path === "plugins" || path.startsWith("plugins/"),
	},
]

const args = parseArgs(process.argv.slice(2))
const target = normalizeTarget(args.platform ?? "win")
const resolved = resolvePackTarget(target)
if (resolved === undefined) {
	fail(
		`unknown --platform ${target} (win | linux | mac) — see scripts/lib/resource-pack-targets.mjs`,
	)
}
const names = packFileNames(resolved)

const version = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).version

const manifestPath = join(releaseDir, names.manifest)
if (!existsSync(manifestPath)) {
	fail(
		`missing ${names.manifest} — run build-resources-pack.mjs --platform ${resolved.slug} first`,
	)
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

const problems = []
const check = (condition, message) => {
	if (!condition) problems.push(message)
}

check(manifest.schema === 1, "manifest.schema is not 1")
check(
	manifest.version === version,
	`manifest version ${String(manifest.version)} ≠ package.json ${version}`,
)
check(
	manifest.platform === resolved.slug,
	`manifest platform ${String(manifest.platform)} ≠ ${resolved.slug}`,
)
check(
	manifest.arch === resolved.arch,
	`manifest arch ${String(manifest.arch)} ≠ ${resolved.arch}`,
)
check(
	/^sha256:[0-9a-f]{64}$/.test(String(manifest.shellHash)),
	"manifest shellHash is not sha256:<hex>",
)
check(
	typeof manifest.electronVersion === "string" &&
		manifest.electronVersion.length > 0,
	"manifest electronVersion missing",
)
check(
	manifest.marker?.schema === 1 &&
		manifest.marker.version === version &&
		manifest.marker.platform === resolved.slug &&
		manifest.marker.arch === resolved.arch &&
		typeof manifest.marker.nodeVersion === "string",
	"manifest marker does not line up with the release",
)

const layerNames = (Array.isArray(manifest.layers) ? manifest.layers : []).map(
	(layer) => layer?.name,
)
check(
	layerNames.join(",") === LAYERS.map((layer) => layer.name).join(","),
	`manifest layers mismatch (got ${layerNames.join(",")})`,
)

for (const layerDef of LAYERS) {
	const layer = (manifest.layers ?? []).find(
		(entry) => entry?.name === layerDef.name,
	)
	if (layer === undefined) continue // already reported by the name check
	const payload = layer.payload
	check(
		typeof payload?.fileName === "string" &&
			payload.fileName.includes(`-${layerDef.name}.tar.gz`),
		`layer ${layerDef.name}: bad payload.fileName`,
	)
	const payloadPath = join(releaseDir, payload?.fileName ?? "")
	check(
		existsSync(payloadPath),
		`layer ${layerDef.name}: payload missing from release dir`,
	)

	if (existsSync(payloadPath)) {
		// Integrity root the client trusts: bytes == manifest hash.
		const size = statSync(payloadPath).size
		check(
			size === payload.size,
			`layer ${layerDef.name}: size ${size} ≠ manifest ${payload.size}`,
		)
		const digest = createHash("sha256")
			.update(readFileSync(payloadPath))
			.digest("hex")
		check(
			digest === payload.sha256,
			`layer ${layerDef.name}: sha256 does not match the manifest`,
		)

		// The archive itself: exactly the expected entries, safely structured.
		const list = await listArchive(payloadPath)
		const topLevel = new Set(
			list.map((entry) => entry.path.split("/")[0]).filter((p) => p.length > 0),
		)
		check(
			topLevel.size === layerDef.topLevel.length &&
				[...topLevel].every((p) => layerDef.topLevel.includes(p)),
			`layer ${layerDef.name}: top-level entries mismatch (got ${[...topLevel].sort().join(",")})`,
		)
		for (const entry of list) {
			const path = entry.path
			check(
				layerDef.containsEntries(path),
				`layer ${layerDef.name}: unexpected entry ${path}`,
			)
			if (layerDef.mustNotContain !== undefined) {
				check(
					!layerDef.mustNotContain(path),
					`layer ${layerDef.name}: forbidden entry ${path}`,
				)
			}
			check(
				!path.startsWith("/") && !/^[A-Za-z]:/.test(path),
				`absolute path in archive: ${path}`,
			)
			check(
				!path.split("/").includes(".."),
				`".." traversal in archive: ${path}`,
			)
			check(
				!path.endsWith(".asar"),
				`archive must not carry asar files: ${path}`,
			)
		}
		check(
			!list.some(
				(entry) => entry.type === "SymbolicLink" || entry.type === "Link",
			),
			`layer ${layerDef.name}: symlink/hardlink in archive`,
		)

		// Layer identity must be reproducible from the staged tree.
		const actualIdentity = await contentHashTree(
			join(stagedRoot, ...layerDef.root),
			{ excludePrefixes: layerDef.excludePrefixes },
		)
		check(
			actualIdentity === layer.identity,
			`layer ${layerDef.name}: identity does not match a fresh hash (${actualIdentity.slice(0, 12)}…)`,
		)
	}
}

// bundled.plugins must reflect the staged tree (diagnostics only).
const stagedPlugins = []
for (const name of readdirSync(join(stagedRoot, "plugins"), {
	withFileTypes: true,
})) {
	if (!name.isDirectory() || name.name === "file") continue
	const stagedManifestPath = join(
		stagedRoot,
		"plugins",
		name.name,
		"manifest.json",
	)
	if (!existsSync(stagedManifestPath)) continue
	const pluginManifest = JSON.parse(readFileSync(stagedManifestPath, "utf8"))
	stagedPlugins.push(`${name.name}@${pluginManifest.version}`)
}
stagedPlugins.sort()
check(
	JSON.stringify(manifest.bundled?.plugins) === JSON.stringify(stagedPlugins),
	"bundled.plugins does not match the staged plugin set",
)

// shellHash must be reproducible from the shell bundle itself.
const actualShellHash = await contentHashTree(shellOutDir, SHELL_HASH_BOUNDARY)
check(
	actualShellHash === manifest.shellHash,
	"shellHash does not match a fresh hash of the shell bundle (out/)",
)

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`[verify-resources-pack] - ${problem}`)
	}
	fail(`${names.manifest} is not consistent with the release artifacts`)
}

console.log(
	`verified resource pack ${names.manifest} (v${version} ${resolved.slug}-${resolved.arch}, ${LAYERS.length} layers, sha256 ok, identities ok, shellHash ok)`,
)

async function listArchive(filePath) {
	const entries = []
	await tar.t({
		file: filePath,
		onentry(entry) {
			entries.push({ path: entry.path.replace(/\\/g, "/"), type: entry.type })
		},
	})
	return entries
}

function fail(message) {
	console.error(`[verify-resources-pack] ${message}`)
	process.exit(1)
}

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
