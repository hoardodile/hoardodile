#!/usr/bin/env node
/**
 * Verify the packaged sidecar actually ships its native dependencies, that
 * the packaged plugin sandbox still boots with its permission model and
 * module policy active (see {@link verifySandboxProbe}), and that the
 * shell asar carries no node_modules tree ({@link checkAsarHasNoNodeModules}).
 *
 * electron-builder drops a `node_modules` that sits at the root of an
 * extraResources copy (see electron-builder.config.mjs), so the server that
 * lands in `resources/server/` must be re-checked after packaging: the
 * rollup bundle externalizes better-sqlite3 / sharp / @node-rs/argon2 and
 * the spawned media binaries, and the sidecar resolves them from
 * `resources/server/node_modules` at runtime (`createRequire` below mirrors
 * that path). A broken installer would otherwise only surface as a sidecar
 * that dies on launch.
 *
 * Add new externalized natives here when they are introduced.
 *
 * Usage:
 *   node scripts/verify-package.mjs                        # host platform
 *   node scripts/verify-package.mjs --platform mac         # darwin arm64
 *   node scripts/verify-package.mjs --platform linux       # linux x64
 */

import { fork, spawn, spawnSync } from "node:child_process"
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCopiedMediaBins } from "../../server/scripts/assert-media-bins.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The v1 release matrix: win32-x64, linux-x64, darwin-arm64. `resourcesRel`
 * is the electron-builder resources path relative to `release/` (the .app
 * bundle on macOS) and the file names are the platform-truth of the staged
 * natives (7-Zip is `7z.exe`/`7zz`, @hoardodile/ffmpeg-bin is
 * `bin/<platform>-<arch>/ffmpeg.exe`/`ffmpeg`).
 */
const LAYOUTS = {
	"win32-x64": {
		releaseDir: "win-unpacked",
		resourcesRel: "resources",
		nodeFile: "node.exe",
		sqlitePrebuild: "win32-x64.node",
		sharpDir: "@img/sharp-win32-x64",
		argonDir: "@node-rs/argon2-win32-x64-msvc",
		ffmpeg: "ffmpeg.exe",
		ffprobe: "ffprobe.exe",
		sevenZip: "bin/win32-x64/7z.exe",
	},
	"linux-x64": {
		releaseDir: "linux-unpacked",
		resourcesRel: "resources",
		nodeFile: "node",
		sqlitePrebuild: "linux-x64.node",
		sharpDir: "@img/sharp-linux-x64",
		argonDir: "@node-rs/argon2-linux-x64-gnu",
		ffmpeg: "ffmpeg",
		ffprobe: "ffprobe",
		sevenZip: "bin/linux-x64/7zz",
	},
	"darwin-arm64": {
		releaseDir: "mac-arm64",
		resourcesRel: "Hoardodile.app/Contents/Resources",
		nodeFile: "node",
		sqlitePrebuild: "darwin-arm64.node",
		sharpDir: "@img/sharp-darwin-arm64",
		argonDir: "@node-rs/argon2-darwin-arm64",
		ffmpeg: "ffmpeg",
		ffprobe: "ffprobe",
		sevenZip: "bin/darwin-arm64/7zz",
	},
}

const args = parseArgs(process.argv.slice(2))
const platform = normalizePlatform(args.platform ?? process.platform)
const arch = args.arch ?? process.arch
const layout = LAYOUTS[`${platform}-${arch}`]
if (layout === undefined) {
	console.error(
		`unsupported verify target ${platform}-${arch}; supported: ${Object.keys(LAYOUTS).join(", ")}`,
	)
	process.exit(1)
}

const serverDir = resolve(
	desktopRoot,
	"release",
	layout.releaseDir,
	layout.resourcesRel,
	"server",
)
const nativeRoot = join(serverDir, "node_modules")

const RESOLVABLE_NATIVES = [
	"better-sqlite3",
	"sharp",
	"@node-rs/argon2",
	"@hoardodile/ffmpeg-bin",
	"@hoardodile/ffprobe-bin",
	"@hoardodile/7z-bin",
]

/** Platform-arch key (`win32-x64`, `linux-x64`, `darwin-arm64`) for the bin folders. */
const binKey = `${platform}-${arch}`

/** Files (relative to nativeRoot) the runtime needs in addition to resolution. */
const REQUIRED_FILES = [
	`better-sqlite3/prebuilds/${layout.sqlitePrebuild}`,
	layout.sharpDir,
	layout.argonDir,
	`@hoardodile/ffmpeg-bin/bin/${binKey}/${layout.ffmpeg}`,
	`@hoardodile/ffprobe-bin/bin/${binKey}/${layout.ffprobe}`,
	`@hoardodile/7z-bin/${layout.sevenZip}`,
]

function main() {
	if (!existsSync(serverDir)) {
		console.error(
			`packaged sidecar missing: ${serverDir}\n` +
				"Run electron-builder first (should have produced a release/ " +
				"directory for this platform).",
		)
		process.exit(1)
	}
	if (!existsSync(nativeRoot)) {
		console.error(
			`sidecar native deps missing: ${nativeRoot}\n` +
				"electron-builder drops a node_modules at the root of an " +
				"extraResources copy; keep the staged server below the copy root " +
				"(see electron-builder.config.mjs).",
		)
		process.exit(1)
	}

	const missing = []
	const requireFromServer = createRequire(join(serverDir, "main.js"))
	for (const name of RESOLVABLE_NATIVES) {
		try {
			requireFromServer.resolve(name)
		} catch {
			missing.push(name)
		}
	}
	for (const relative of REQUIRED_FILES) {
		if (!existsSync(join(nativeRoot, relative))) {
			missing.push(relative)
		}
	}

	// The staged server must actually ship the SPA bundle; the packaged app
	// resolves `/` from this `web/` tree, so a missing index.html would leave
	// the desktop with no web UI (a clean 503 at `/`).
	if (!existsSync(join(serverDir, "web", "index.html"))) {
		missing.push("web/index.html (bundled SPA)")
	}

	checkNodeRuntime(layout, missing)

	const asarPath = resolve(
		desktopRoot,
		"release",
		layout.releaseDir,
		layout.resourcesRel,
		"app.asar",
	)
	checkAsarHasNoNodeModules(asarPath, missing)

	if (missing.length > 0) {
		console.error("packaged sidecar is missing native dependencies:")
		for (const entry of missing) {
			console.error(`  - ${entry}`)
		}
		process.exit(1)
	}

	assertCopiedMediaBins(nativeRoot)
	console.log(
		`verified sidecar natives in ${serverDir} (${RESOLVABLE_NATIVES.length} packages, media bins ok)`,
	)
}

/**
 * The staged Node runtime itself: presence (it is the sidecar, so a
 * missing binary is a broken installer), the executable bit on POSIX, and
 * a valid signature on macOS (ad-hoc signed in stage-resources.mjs).
 */
function checkNodeRuntime(layout, missing) {
	const nodeDir = resolve(
		desktopRoot,
		"release",
		layout.releaseDir,
		layout.resourcesRel,
		"node",
	)
	const nodePath = join(nodeDir, layout.nodeFile)
	if (!existsSync(nodePath)) {
		missing.push(`node/${layout.nodeFile}`)
		return
	}
	if (platform !== "win32") {
		const mode = statSync(nodePath).mode
		if ((mode & 0o111) === 0)
			missing.push(`node/${layout.nodeFile} not executable`)
	}
	if (platform === "darwin") {
		const res = spawnSync("codesign", ["--verify", "--strict", nodePath], {
			stdio: "ignore",
			timeout: 30_000,
		})
		if (res.error !== undefined || res.status !== 0) {
			missing.push(`node binary failed codesign --verify (${nodePath})`)
		}
	}
}

/**
 * The shell bundle is self-contained (vite ssr noExternal; only "electron"
 * and node builtins stay external), so the asar must never carry a
 * node_modules tree. electron-builder's default dependency collection
 * would walk the pnpm store and asar-copy it; `files` excludes it, and
 * this guard turns a dropped negation back into a hard failure instead of
 * a silently bloated installer.
 */
function checkAsarHasNoNodeModules(asarPath, missing) {
	if (!existsSync(asarPath)) {
		missing.push(`app.asar missing (${asarPath})`)
		return
	}
	const file = readFileSync(asarPath)
	const headerLength = file.readUInt32LE(12)
	if (headerLength <= 0 || 16 + headerLength > file.length) {
		missing.push(`app.asar header unreadable (${asarPath})`)
		return
	}
	const header = JSON.parse(file.toString("utf8", 16, 16 + headerLength))
	const offenders = []
	collectNodeModules(header.files, "", offenders)
	for (const path of offenders) missing.push(`app.asar contains ${path}`)
}

function collectNodeModules(filesNode, prefix, offenders) {
	if (!isRecord(filesNode)) return
	for (const [name, entry] of Object.entries(filesNode)) {
		const path = `${prefix}${name}`
		if (name === "node_modules") offenders.push(path)
		if (isRecord(entry?.files))
			collectNodeModules(entry.files, `${path}/`, offenders)
	}
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Spawn the packaged sandbox entry as a real restricted child and assert
 * its startup self-checks pass (permission model + module policy active).
 * The child only answers `loaded` after every self-check succeeded, so a
 * packaged build where the sandbox is broken surfaces here instead of as
 * "every plugin fails to load" inside the user's app.
 */
async function verifySandboxProbe() {
	const entry = join(serverDir, "chunks", "worker-entry.mjs")
	if (!existsSync(entry)) {
		console.error(`packaged sandbox entry missing: ${entry}`)
		process.exit(1)
	}
	const permissionFlag = await resolvePermissionFlag()
	if (permissionFlag === undefined) {
		console.error(
			"packaged Node build has no permission-model flag — refusing to verify a sandbox that cannot run",
		)
		process.exit(1)
	}

	const probeDir = mkdtempSync(join(tmpdir(), "hoardodile-sandbox-verify-"))
	const child = fork(entry, [probeDir, entry], {
		execArgv: [
			permissionFlag,
			`--allow-fs-read=${probeDir}${sep}`,
			`--allow-fs-read=${entry}`,
			"--max-old-space-size=128",
		],
		serialization: "advanced",
		stdio: ["ignore", "ignore", "inherit", "ipc"],
	})
	try {
		const reply = await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("sandbox probe timed out after 10s")),
				10_000,
			)
			child.on("message", (msg) => {
				clearTimeout(timer)
				resolve(msg)
			})
			child.on("exit", (code) => {
				clearTimeout(timer)
				reject(new Error(`sandbox child exited before replying (code ${code})`))
			})
			child.on("error", (err) => {
				clearTimeout(timer)
				reject(err)
			})
			// The main.js is missing on purpose — `loaded: ok:false` is the
			// expected reply; the self-checks are what this probe verifies.
			child.send({ type: "load", mainPath: join(probeDir, "missing.js") })
		})
		if (
			typeof reply !== "object" ||
			reply === null ||
			reply.type !== "loaded"
		) {
			throw new Error(`unexpected sandbox reply: ${JSON.stringify(reply)}`)
		}
	} finally {
		child.kill()
		rmSync(probeDir, { recursive: true, force: true })
	}
}

/**
 * Mirror of `sandbox/host.ts`'s flag probe: the permission model was
 * introduced as `--experimental-permission` and stabilized under
 * `--permission`; keep the first candidate the runtime accepts.
 */
async function resolvePermissionFlag() {
	for (const flag of ["--permission", "--experimental-permission"]) {
		if (await acceptsFlag(flag)) return flag
	}
	return undefined
}

function acceptsFlag(flag) {
	return new Promise((resolveProbe) => {
		const probe = spawn(process.execPath, [flag, "-e", "process.exit(0)"], {
			stdio: "ignore",
			timeout: 10_000,
		})
		probe.on("exit", (code) => resolveProbe(code === 0))
		probe.on("error", () => resolveProbe(false))
	})
}

function parseArgs(argv) {
	const out = {}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--platform" || arg === "--arch") {
			const key = arg.slice(2)
			out[key] = argv[++index]
			if (out[key] === undefined) throw new Error(`${arg} needs a value`)
			continue
		}
		throw new Error(`unknown argument: ${arg}`)
	}
	return out
}

function normalizePlatform(value) {
	if (value === "win") return "win32"
	if (value === "mac" || value === "darwin") return "darwin"
	return value
}

await main()
await verifySandboxProbe()
console.log(
	"[verify-package] sandbox probe ok (permission model + module policy active)",
)
