#!/usr/bin/env node
/**
 * Download a pinned official Node.js runtime for the sidecar
 * (electron-builder extraResources), sha256-verified against the
 * nodejs.org SHASUMS256.txt manifest before use.
 *
 * The sidecar must run a Node build whose ABI matches the packaged
 * native modules: better-sqlite3 prebuilds, sharp and @node-rs/argon2 are
 * bound to NODE_MODULE_VERSION (137 = Node 24.x), so NODE_DIST_VERSION
 * stays on the latest Node 24 LTS and must never drift off the major
 * used by the build toolchain (`engines.node`).
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const NODE_DIST_VERSION = "24.15.0"

const DIST_BASE = `https://nodejs.org/dist/v${NODE_DIST_VERSION}`

function archiveName(platform, arch) {
	if (platform === "win32") return `node-v${NODE_DIST_VERSION}-win-${arch}.zip`
	if (platform === "linux")
		return `node-v${NODE_DIST_VERSION}-linux-${arch}.tar.xz`
	if (platform === "darwin")
		return `node-v${NODE_DIST_VERSION}-darwin-${arch}.tar.gz`
	throw new Error(`unsupported node dist platform: ${platform}`)
}

/**
 * Ensure the pinned Node runtime for `sourcePlatform`/`arch` is present
 * in `destDir` as `node.exe` (win32) or `node` (posix, executable bit
 * set, ad-hoc signed on macOS) and return its path.
 *
 * The archive itself is cached under `cacheDir` (sha256-verified on first
 * fetch; a corrupted cached archive is deleted and re-downloaded).
 */
export async function installNodeDist({
	sourcePlatform,
	arch,
	cacheDir,
	destDir,
}) {
	const fileName = archiveName(sourcePlatform, arch)
	const archivePath = join(cacheDir, fileName)
	if (!existsSync(archivePath)) {
		mkdirSync(cacheDir, { recursive: true })
		await fetchFile(`${DIST_BASE}/${fileName}`, archivePath)
	}

	const sums = await fetchText(`${DIST_BASE}/SHASUMS256.txt`)
	const expected = sums
		.split("\n")
		.find((line) => line.endsWith(`  ${fileName}`))
		?.trim()
		.split(/\s+/)[0]
	if (expected === undefined) {
		throw new Error(`no sha256 entry for ${fileName} in SHASUMS256.txt`)
	}
	const actual = createHash("sha256")
		.update(readFileSync(archivePath))
		.digest("hex")
	if (actual !== expected) {
		// Could be a partially cached download — drop it and fail loudly
		// instead of silently shipping a tampered runtime.
		rmSync(archivePath, { force: true })
		throw new Error(`sha256 mismatch for ${fileName}: ${actual} ≠ ${expected}`)
	}

	const extractDir = join(tmpdir(), `node-dist-${process.pid}`)
	rmSync(extractDir, { recursive: true, force: true })
	mkdirSync(extractDir, { recursive: true })
	try {
		// GNU tar (linux) and bsdtar (macOS) both auto-detect the
		// compression format; Windows never reaches this branch (win32
		// packaging reuses the running official Node binary).
		const res = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], {
			stdio: "ignore",
			timeout: 120_000,
		})
		if (res.error !== undefined) throw res.error
		if (res.status !== 0)
			throw new Error(`tar -xf exited ${String(res.status)}`)

		const rootName = `node-v${NODE_DIST_VERSION}-${sourcePlatform}-${arch}`
		const srcBin = join(extractDir, rootName, "bin", "node")
		if (!existsSync(srcBin))
			throw new Error(`node binary missing in ${rootName}`)

		const binName = sourcePlatform === "win32" ? "node.exe" : "node"
		const destPath = join(destDir, binName)
		mkdirSync(destDir, { recursive: true })
		copyFileSync(srcBin, destPath)
		chmodSync(destPath, 0o755)

		if (sourcePlatform === "darwin") {
			// A nested Mach-O executable must carry a signature for the
			// app bundle to stay signable/notarizable; ad-hoc works until
			// a real identity is wired in.
			const res = spawnSync("codesign", ["--force", "--sign", "-", destPath], {
				stdio: "ignore",
				timeout: 30_000,
			})
			if (res.error !== undefined) throw res.error
			if (res.status !== 0) {
				throw new Error(`codesign -s - exited ${String(res.status)}`)
			}
		}
		return destPath
	} finally {
		rmSync(extractDir, { recursive: true, force: true })
	}
}

async function fetchText(url) {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`fetch ${url} failed (${String(response.status)})`)
	}
	return response.text()
}

async function fetchFile(url, destPath) {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`fetch ${url} failed (${String(response.status)})`)
	}
	writeFileSync(destPath, Buffer.from(await response.arrayBuffer()))
}
