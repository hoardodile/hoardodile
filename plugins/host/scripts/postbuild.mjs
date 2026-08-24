/**
 * Post-build steps for the host package:
 *  1. Copy the sandbox entry into dist/chunks. The sandbox module lives
 *     in exactly one shared chunk at `dist/chunks/host.js` (fixed chunk
 *     names) and spawns the child by relative file path, so the entry
 *     must sit next to it — forked child processes get no transforms, it
 *     ships as plain ESM exactly as authored. (The module policy hook is
 *     inlined in the entry, so only one file ships.)
 *  2. Dist-level smoke: spawn a REAL sandbox child from dist and run
 *     `detect` against a fixture plugin. This is the cheapest guard
 *     against the sandbox silently dying in published artifacts (missing
 *     entry, broken protocol import, bundled-away node builtins, a Node
 *     runtime without the permission model or registerHooks).
 *
 * Run after `tsup` (wired as the package `build` script).
 */
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC_WORKER = join(ROOT, "src", "sandbox", "worker-entry.mjs")
const DIST_WORKER = join(ROOT, "dist", "chunks", "worker-entry.mjs")
mkdirSync(dirname(DIST_WORKER), { recursive: true })
copyFileSync(SRC_WORKER, DIST_WORKER)
console.log("[host:postbuild] worker-entry.mjs copied to dist/chunks/")

const {
	DEFAULT_SANDBOX_CONFIG,
	createPluginSandbox,
	createDirectoryResourceAPI,
} = await import(pathToFileURL(join(ROOT, "dist", "index.js")).href)

const fixture = join(ROOT, "src", "sandbox", "fixtures", "echo-plugin.mjs")
const smokeDir = mkdtempSync(join(tmpdir(), "hoardodile-host-smoke-"))
writeFileSync(join(smokeDir, "blob.bin"), Buffer.from([1, 2, 3]))
const sandbox = createPluginSandbox(DEFAULT_SANDBOX_CONFIG)
try {
	const definition = await sandbox.loadPlugin({
		id: "dist-smoke",
		mainPath: fixture,
		eager: true,
	})
	if (definition === undefined) {
		throw new Error(
			"[host:postbuild] sandbox failed to load the fixture plugin",
		)
	}
	const api = createDirectoryResourceAPI(smokeDir)
	const result = await definition.detect(api)
	if (!result.ok) {
		throw new Error(`[host:postbuild] detect failed: ${JSON.stringify(result)}`)
	}
	console.log(
		"[host:postbuild] dist smoke passed (real sandbox child, detect ok)",
	)
} finally {
	await sandbox.disposeAll()
	rmSync(smokeDir, { recursive: true, force: true })
}
