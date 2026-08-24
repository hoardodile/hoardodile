#!/usr/bin/env node
/**
 * Build the resource-pack channel artifacts for one platform.
 *
 * The pack is the unit of the resource-layer update: everything under the
 * installed `resources/` that the shell spawns — the Node runtime, the
 * server tree and the seed plugins. The payload is LAYERED so a typical
 * release (server/web code only) downloads ~15 MB instead of the whole
 * tree: `node` (runtime bumps only), `server-dist` (everything under
 * server/ except node_modules), `server-node_modules` (dependency bumps
 * only) and `plugins`. The Electron runtime and the shell asar are
 * deliberately NOT in the pack: they live outside `resources/` and any
 * change there must go through a full electron-updater install.
 *
 * Run after stage-resources + electron-builder (the chain in
 * apps/desktop/package.json): staging produced extra-resources/, and the
 * layers are built from the same tree the installer carried.
 *
 * Usage:
 *   node scripts/build-resources-pack.mjs [--platform win|linux|mac] [--arch x64|arm64] [--version X.Y.Z]
 *
 * `--version` overrides the marker/manifest version — tests only (the
 * e2e fixture build); the CI chain always uses the root package version
 * and verify-resources-pack enforces it.
 *
 * The matrix lives in scripts/lib/resource-pack-targets.mjs; keep the
 * layer definitions in sync with the client
 * (apps/desktop/src/main/update-plan.ts) and the verify script.
 */

import { createHash } from "node:crypto"
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as tar from "tar"
import {
	normalizeTarget,
	packFileNames,
	resolvePackTarget,
} from "../../../scripts/lib/resource-pack-targets.mjs"
import { contentHashTree } from "../../../scripts/lib/shell-hash.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const stagedRoot = join(desktopRoot, "extra-resources")
const releaseDir = join(desktopRoot, "release")
const shellOutDir = join(desktopRoot, "out")

/**
 * Layer definitions — the client mirrors name/root/exclusion in
 * `neededLayers` (apps/desktop/src/main/update-plan.ts) and the verify
 * script replays the same identities.
 */
export const PACK_LAYERS = [
	{
		name: "node",
		root: ["node"],
		excludePrefixes: [],
		archiveEntries: ["node"],
	},
	{
		name: "server-dist",
		root: ["server"],
		excludePrefixes: ["node_modules"],
		archiveEntries: ["server"],
		archiveFilter: (path) =>
			path !== "server/node_modules" &&
			!path.startsWith("server/node_modules/"),
	},
	{
		name: "server-node_modules",
		root: ["server", "node_modules"],
		excludePrefixes: [],
		archiveEntries: ["server/node_modules"],
	},
	{
		name: "plugins",
		root: ["plugins"],
		excludePrefixes: [],
		archiveEntries: ["plugins"],
	},
]

function fail(message) {
	console.error(`[build-resources-pack] ${message}`)
	process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
const target = normalizeTarget(args.platform ?? process.platform)
const resolved = resolvePackTarget(target, args.arch)
if (resolved === undefined) {
	fail(`unsupported --platform ${target} (win32 | linux | darwin)`)
}
const names = packFileNames(resolved)

if (!existsSync(join(stagedRoot, "server", "main.js"))) {
	fail(
		`missing staged server tree at ${stagedRoot} — run stage-resources.mjs for ${resolved.slug}-${resolved.arch} first`,
	)
}
if (!existsSync(join(shellOutDir, "main", "index.js"))) {
	fail(`missing shell build at ${shellOutDir} — run the desktop build first`)
}

const rootVersion = JSON.parse(
	readFileSync(join(workspaceRoot, "package.json"), "utf8"),
).version
const version = args.version ?? rootVersion

// shellHash = content hash of the shell bundle (out/**). The client
// recomputes it over the asar's own out/ subtree — byte-identical when
// the installed shell is this release's shell.
const shellHash = await contentHashTree(shellOutDir)

const marker = {
	schema: 1,
	version,
	nodeVersion: JSON.parse(
		readFileSync(join(stagedRoot, "resources-version.json"), "utf8"),
	).nodeVersion,
	platform: resolved.slug,
	arch: resolved.arch,
}

const plugins = []
for (const name of readdirSync(join(stagedRoot, "plugins"), {
	withFileTypes: true,
})) {
	if (!name.isDirectory() || name.name === "file") continue
	const manifestPath = join(stagedRoot, "plugins", name.name, "manifest.json")
	if (!existsSync(manifestPath)) continue
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
	plugins.push(`${name.name}@${manifest.version}`)
}
plugins.sort()

const layers = []
for (const layer of PACK_LAYERS) {
	const layerRoot = join(stagedRoot, ...layer.root)
	if (!existsSync(layerRoot)) {
		fail(`staged layer root missing: ${layerRoot} (${layer.name})`)
	}
	const identity = await contentHashTree(layerRoot, {
		excludePrefixes: layer.excludePrefixes,
	})
	const fileName = `resources-layer-${resolved.slug}-${resolved.arch}-${layer.name}.tar.gz`
	const payloadPath = join(releaseDir, fileName)
	rmSync(payloadPath, { force: true })
	await tar.c(
		{
			gzip: true,
			file: payloadPath,
			cwd: stagedRoot,
			filter: layer.archiveFilter,
			// Preserve exec bits (needed for the linux/mac node runtime);
			// the manifest sha256 is computed from this very file, so the
			// archive itself needs no determinism.
		},
		layer.archiveEntries,
	)
	layers.push({
		name: layer.name,
		identity,
		payload: {
			fileName,
			sha256: sha256File(payloadPath),
			size: statSync(payloadPath).size,
		},
	})
}

const manifest = {
	schema: 1,
	version,
	platform: resolved.slug,
	arch: resolved.arch,
	shellHash,
	electronVersion: electronVersionOf(),
	installedYaml: installedYamlOf(resolved.platform),
	marker,
	bundled: {
		node: marker.nodeVersion,
		server: marker.version,
		plugins,
	},
	layers,
}

const manifestPath = join(releaseDir, names.manifest)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8")

console.log(
	`built resource pack ${names.manifest} (v${version} ${resolved.slug}-${resolved.arch}, ${layers.length} layers, shellHash ${shellHash.slice(0, 16)}…)`,
)
for (const layer of layers) {
	console.log(
		`  - ${layer.name}: ${layer.payload.size} bytes, identity ${layer.identity.slice(0, 16)}…`,
	)
}

function electronVersionOf() {
	// The resolved Electron version the app bundles; the client compares
	// it against process.versions.electron — a mismatch forces full.
	const pkg = JSON.parse(
		readFileSync(
			join(desktopRoot, "node_modules", "electron", "package.json"),
			"utf8",
		),
	)
	return pkg.version
}

function installedYamlOf(platform) {
	if (platform === "win32") return "nsis"
	if (platform === "linux") return "AppImage"
	return "dmg+zip"
}

function sha256File(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function parseArgs(argv) {
	const out = {}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--platform" || arg === "--arch" || arg === "--version") {
			const key = arg.slice(2)
			out[key] = argv[++index]
			if (out[key] === undefined) throw new Error(`${arg} needs a value`)
			continue
		}
		throw new Error(`unknown argument: ${arg}`)
	}
	return out
}
