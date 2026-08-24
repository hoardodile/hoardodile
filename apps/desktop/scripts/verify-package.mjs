#!/usr/bin/env node
/**
 * Verify the packaged sidecar actually ships its native dependencies, and
 * that the packaged plugin sandbox still boots with its permission model
 * and module policy active (see {@link verifySandboxProbe}).
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
 *   node scripts/verify-package.mjs            # after electron-builder ran
 */

import { fork, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCopiedMediaBins } from "../../server/scripts/assert-media-bins.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const serverDir = resolve(
	desktopRoot,
	"release",
	"win-unpacked",
	"resources",
	"server",
)
const nativeRoot = join(serverDir, "node_modules")

const RESOLVABLE_NATIVES = [
	"better-sqlite3",
	"sharp",
	"@node-rs/argon2",
	"ffmpeg-static",
	"@derhuerst/ffprobe-static",
	"@hoardodile/7z-bin",
]

/** Files (relative to nativeRoot) the runtime needs in addition to resolution. */
const REQUIRED_FILES = [
	"better-sqlite3/prebuilds/win32-x64.node",
	"@img/sharp-win32-x64",
	"@node-rs/argon2-win32-x64-msvc",
	"ffmpeg-static/ffmpeg.exe",
	"@derhuerst/ffprobe-static/ffprobe.exe",
	"@hoardodile/7z-bin/bin/win32-x64/7z.exe",
]

function main() {
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

await main()
await verifySandboxProbe()
console.log(
	"[verify-package] sandbox probe ok (permission model + module policy active)",
)
