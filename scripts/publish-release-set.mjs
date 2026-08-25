#!/usr/bin/env node
/**
 * Publish every release-set package whose version is missing from npm.
 *
 * Wired into release.yml's npm job in place of `pnpm -r publish`: a tag
 * push publishes all new versions, but a `workflow_dispatch` re-run of an
 * already-released version (introduced to complete a release whose tag
 * predates a pipeline fix) must not fail with "version already exists" —
 * it only needs to fix the legs that failed the first time.
 *
 * Trusted publishing (OIDC) still applies per package: each publish
 * requests the id-token and attaches provenance attestations.
 *
 *   node scripts/publish-release-set.mjs
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import { PUBLISHED_PACKAGE_MANIFESTS } from "./lib/release-packages.mjs"

// The npm view read hits the same CDN the writes do; a replica lag just
// after a very recent publish could double-publish a version. npm rejects
// the duplicate PUT, so retry once after a pause before giving up.
const RETRY_DELAY_MS = 60_000

function publishedVersion(packageName) {
	try {
		return execFileSync("npm", ["view", packageName, "version"], {
			encoding: "utf8",
		}).trim()
	} catch {
		return undefined
	}
}

function publish(packageName) {
	execFileSync(
		"pnpm",
		["publish", "--filter", packageName, "--config.provenance=true"],
		{ stdio: "inherit" },
	)
}

function reportWorkingTree() {
	// pnpm's publish git check refuses a dirty tree; print what is dirty so
	// a failing run is diagnosable at a glance.
	try {
		const status = execFileSync("git", ["status", "--porcelain"], {
			encoding: "utf8",
		})
		if (status.trim() !== "") {
			console.log("working tree is dirty before publish:")
			process.stdout.write(status)
		}
	} catch {
		// git unavailable — pnpm's own check reports it
	}
}

async function main() {
	reportWorkingTree()
	let published = 0
	let skipped = 0
	for (const manifestPath of PUBLISHED_PACKAGE_MANIFESTS) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		const { name, version } = manifest
		if (publishedVersion(name) === version) {
			console.log(`skipping ${name}@${version} (already on npm)`)
			skipped += 1
			continue
		}
		try {
			publish(name)
		} catch {
			console.log(`retrying ${name}@${version} after ${RETRY_DELAY_MS}ms...`)
			await sleep(RETRY_DELAY_MS)
			publish(name)
		}
		published += 1
		console.log(`published ${name}@${version}`)
	}
	console.log(`publish set done: ${published} published, ${skipped} skipped`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
